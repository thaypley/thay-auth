/**
 * SQLite operation core — all direct-DB logic for the DIRECT_SQL_USERS
 * signup path. Runs inside the sqlite worker (real path) or inline on
 * the main thread (fallback), so both execute identical code.
 *
 * One pooled DatabaseSync connection (WAL-safe, busy_timeout 5s,
 * synchronous NORMAL), cached prepared statements, cached schema
 * introspection, rejection-sampled id generation.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import crypto from 'node:crypto';

const PB_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_KEY_LEN = 50;
const TOKEN_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const pools = new Map<string, DatabaseSync>();
const prepared = new Map<string, StatementSync>();
const schemaCache = new Map<string, Set<string> | null>();
const insertPlanCache = new Map<string, { sql: string; names: string[] } | null>();

function getDb(dbPath: string): DatabaseSync {
  let db = pools.get(dbPath);
  if (!db) {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA synchronous = NORMAL');
    pools.set(dbPath, db);
  }
  return db;
}

function stmt(dbPath: string, sql: string): StatementSync {
  const key = `${dbPath}\u0000${sql}`;
  let s = prepared.get(key);
  if (!s) {
    s = getDb(dbPath).prepare(sql);
    prepared.set(key, s);
  }
  return s;
}

function pbId(): string {
  // Rejection sampling: draw bytes only from [0, floor(256/36)*36) so
  // each of the 36 alphabet chars is exactly equally likely.
  const n = PB_ID_ALPHABET.length;
  const max = Math.floor(256 / n) * n;
  const out = new Array<string>(15);
  const bytes = crypto.randomBytes(15);
  for (let i = 0; i < 15; i++) {
    let b = bytes[i];
    while (b >= max) b = crypto.randomBytes(1)[0];
    out[i] = PB_ID_ALPHABET[b % n];
  }
  return out.join('');
}

function tokenKey(): string {
  // Deterministic 50 alphanumeric chars, uniform (rejection sampling).
  // The old base64-strip approach produced 49-51 chars whenever the
  // random bytes encoded a '+' or '/' — length drift that PB's opaque
  // tokenKey column never promised to tolerate.
  const n = TOKEN_KEY_ALPHABET.length; // 62
  const max = Math.floor(256 / n) * n; // 248
  const out = new Array<string>(TOKEN_KEY_LEN);
  const bytes = crypto.randomBytes(TOKEN_KEY_LEN);
  for (let i = 0; i < TOKEN_KEY_LEN; i++) {
    let b = bytes[i];
    while (b >= max) b = crypto.randomBytes(1)[0];
    out[i] = TOKEN_KEY_ALPHABET[b % n];
  }
  return out.join('');
}

function pbNow(): string {
  return new Date().toISOString();
}

/** Typed duplicate error so routes can return stable, non-enumerable messages. */
export class DuplicateFieldError extends Error {
  constructor(public readonly field: 'email' | 'username') {
    super(`duplicate ${field}`);
    this.name = 'DuplicateFieldError';
  }
}

function getColumns(dbPath: string): Set<string> | null {
  let cols = schemaCache.get(dbPath);
  if (cols === undefined) {
    const rows = stmt(dbPath, 'PRAGMA table_info(users)').all() as Array<{ name: string }>;
    cols = rows.length > 0 ? new Set(rows.map((r) => r.name)) : null;
    schemaCache.set(dbPath, cols);
  }
  return cols;
}

function getInsertPlan(dbPath: string): { sql: string; names: string[] } | null {
  let plan = insertPlanCache.get(dbPath);
  if (plan === undefined) {
    const cols = getColumns(dbPath);
    if (!cols || !cols.has('password') || !cols.has('email')) {
      plan = null;
    } else {
      const wanted: Array<[string, string | number | null]> = [
        ['id', ''],
        ['email', ''],
        ['username', ''],
        ['password', ''],
        ['tokenKey', ''],
        ['accountType', ''],
        ['birthday', ''],
        ['age', 0],
        ['tier', ''],
        ['isVerified', 0],
        ['isArchitect', 0],
        ['verified', 0],
        ['emailVisibility', 0],
        ['avatar', ''],
        ['name', ''],
        ['emailVerificationCode', ''],
        ['emailVerificationCodeExpiry', ''],
        ['lastUsernameChangeAt', ''],
        ['created', ''],
        ['updated', ''],
      ];
      const present = wanted.filter(([name]) => cols.has(name));
      const names = present.map(([n]) => n);
      const placeholders = names.map((n) => '@' + n).join(', ');
      plan = { sql: `INSERT INTO users (${names.join(', ')}) VALUES (${placeholders})`, names };
    }
    insertPlanCache.set(dbPath, plan);
  }
  return plan;
}

export interface DirectInsertInput {
  email: string;
  password: string;
  username: string;
  accountType: string;
  birthday: string;
  age: number;
  isVerified?: boolean;
  tier?: string;
}

export interface DirectInsertResult {
  id: string;
  email: string;
  username: string;
  accountType: string;
  birthday: string;
  age: number;
  isVerified: boolean;
  isArchitect: boolean;
  tier: string;
  avatar: string;
  created: string;
  updated: string;
}

/**
 * Execute a signup op. Throws DuplicateFieldError on a UNIQUE-constraint
 * race (the client rehydrates it across the worker boundary).
 */
export function runOp(op: string, payload: any): any {
  switch (op) {
    case 'exists': {
      const byEmail = stmt(payload.dbPath, 'SELECT 1 FROM users WHERE email = ? LIMIT 1').get(payload.email);
      const byUsername = stmt(payload.dbPath, 'SELECT 1 FROM users WHERE username = ? LIMIT 1').get(payload.username);
      return { email: !!byEmail, username: !!byUsername };
    }

    case 'insert': {
      const plan = getInsertPlan(payload.dbPath);
      if (!plan) throw new Error('users table missing required columns (password/email)');

      const id = pbId();
      const tk = tokenKey();
      const now = pbNow();

      const values: Record<string, string | number | null> = {
        id,
        email: payload.email,
        username: payload.username,
        password: payload.password,
        tokenKey: tk,
        accountType: payload.accountType,
        birthday: payload.birthday,
        age: payload.age,
        tier: payload.tier,
        isVerified: payload.isVerified,
        isArchitect: 0,
        verified: 0,
        emailVisibility: 0,
        avatar: '',
        name: '',
        emailVerificationCode: '',
        emailVerificationCodeExpiry: '',
        lastUsernameChangeAt: '',
        created: now,
        updated: now,
      };
      const params: Record<string, string | number | null> = {};
      for (const name of plan.names) params[name] = values[name];

      try {
        stmt(payload.dbPath, plan.sql).run(params);
      } catch (err) {
        const msg = (err as Error).message || '';
        const m = /UNIQUE constraint failed: users\.(email|username)/.exec(msg);
        if (m) throw new DuplicateFieldError(m[1] as 'email' | 'username');
        throw err;
      }
      return { id, created: now, updated: now };
    }

    case 'redeem': {
      const result = stmt(
        payload.dbPath,
        `UPDATE signup_invites
           SET useCount = useCount + 1,
               used = (useCount + 1 >= ?),
               usedBy = ?,
               usedAt = ?
         WHERE id = ? AND useCount < ?`,
      ).run(payload.maxUses, payload.userId, pbNow(), payload.inviteId, payload.maxUses);
      return (result.changes ?? 0) > 0;
    }

    case 'close': {
      prepared.clear();
      schemaCache.clear();
      insertPlanCache.clear();
      for (const db of pools.values()) {
        try {
          db.close();
        } catch {
          /* already closed */
        }
      }
      pools.clear();
      return { ok: true };
    }

    default:
      throw new Error(`unknown sqlite op: ${op}`);
  }
}
