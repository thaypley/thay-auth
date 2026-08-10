/**
 * Direct-SQL user insert — bypass for the broken PocketBase admin
 * `POST /api/collections/users/records` endpoint.
 *
 * Writes a fully-shaped `users` row into `pb_data/data.db` so that PB's
 * Go auth verifier (which only reads `users.email` + `users.password`)
 * accepts the new user on the next `authWithPassword` call.
 *
 * Performance changes vs. the original:
 *  - ONE pooled DatabaseSync connection (WAL-safe, busy_timeout=5s,
 *    synchronous=NORMAL) instead of opening a fresh connection per call.
 *    Signup used to open THREE connections (exists-check, insert,
 *    invite redeem); each open does file I/O + WAL setup.
 *  - Prepared statements are cached per connection — no re-prepare cost.
 *  - The `users` table column introspection runs once per path, not per
 *    insert.
 *  - pbId() uses rejection sampling — the old `bytes[i] % 36` had modulo
 *    bias (256 % 36 = 4), skewing id chars slightly.
 *
 * NOTE: DatabaseSync is synchronous — it briefly blocks the event loop.
 * Signup is rate-limited (10/15min/IP), and each statement is a
 * sub-millisecond WAL write, so the blocking is bounded. This is the
 * explicit trade-off for bypassing PB's broken admin create.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { hashPasswordBcrypt } from '../utils/bcrypt.js';
import { logger } from '../utils/logger.js';

const PB_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_KEY_LEN = 50;

// Connection pool (per dbPath — one path in practice).
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

/** Close pooled connections on graceful shutdown. */
export function closeDirectSql(): void {
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
  // PB uses crypto/rand base64-ish output; a 50-char random alphanumeric
  // string is functionally equivalent for the unique-index check.
  return crypto.randomBytes(Math.ceil((TOKEN_KEY_LEN * 3) / 4))
    .toString('base64')
    .replace(/[+/=]/g, '')
    .slice(0, TOKEN_KEY_LEN);
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

function getColumns(dbPath: string): Set<string> | null {
  let cols = schemaCache.get(dbPath);
  if (cols === undefined) {
    const rows = stmt(dbPath, 'PRAGMA table_info(users)').all() as Array<{ name: string }>;
    cols = rows.length > 0 ? new Set(rows.map((r) => r.name)) : null;
    schemaCache.set(dbPath, cols);
  }
  return cols;
}

interface InsertPlan {
  sql: string;
  names: string[];
}

function getInsertPlan(dbPath: string): InsertPlan | null {
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

export async function createUserDirect(
  dbPath: string,
  input: DirectInsertInput,
): Promise<DirectInsertResult> {
  const passwordHash = await hashPasswordBcrypt(input.password);

  const id = pbId();
  const tk = tokenKey();
  const now = pbNow();
  const isVerified = input.isVerified ? 1 : 0;
  const tier = input.tier || 'free';

  const plan = getInsertPlan(dbPath);
  if (!plan) throw new Error('users table missing required columns (password/email)');

  const params: Record<string, string | number | null> = {};
  const values: Record<string, string | number | null> = {
    id,
    email: input.email,
    username: input.username,
    password: passwordHash,
    tokenKey: tk,
    accountType: input.accountType,
    birthday: input.birthday,
    age: input.age,
    tier,
    isVerified,
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
  for (const name of plan.names) params[name] = values[name];

  try {
    stmt(dbPath, plan.sql).run(params);
  } catch (err) {
    // Race-safe duplicate detection: the UNIQUE indexes are the real
    // enforcement; this maps the failure to a typed, field-specific error.
    const msg = (err as Error).message || '';
    const m = /UNIQUE constraint failed: users\.(email|username)/.exec(msg);
    if (m) throw new DuplicateFieldError(m[1] as 'email' | 'username');
    logger.error('direct-sql user insert failed:', err);
    throw err;
  }

  return {
    id,
    email: input.email,
    username: input.username,
    accountType: input.accountType,
    birthday: input.birthday,
    age: input.age,
    isVerified: !!isVerified,
    isArchitect: false,
    tier,
    avatar: '',
    created: now,
    updated: now,
  };
}

/**
 * Fast-path duplicate check (before spending a bcrypt round, ~78ms).
 * The unique indexes are the real enforcement — this only short-circuits
 * the common case and returns a stable error message.
 */
export function userExistsDirect(
  dbPath: string,
  email: string,
  username: string,
): { email: boolean; username: boolean } {
  const byEmail = stmt(dbPath, 'SELECT 1 FROM users WHERE email = ? LIMIT 1').get(email);
  const byUsername = stmt(dbPath, 'SELECT 1 FROM users WHERE username = ? LIMIT 1').get(username);
  return { email: !!byEmail, username: !!byUsername };
}

/**
 * Atomically redeem an invite (compare-and-swap on useCount) so two
 * concurrent signups with the same code can't both pass the check — the
 * PB-admin path reads-then-writes (TOCTOU). Returns true when the row was
 * actually updated, false when the code is exhausted/absent.
 */
export function redeemInviteDirect(
  dbPath: string,
  inviteId: string,
  maxUses: number,
  userId: string,
): boolean {
  const result = stmt(
    dbPath,
    `UPDATE signup_invites
       SET useCount = useCount + 1,
           used = (useCount + 1 >= ?),
           usedBy = ?,
           usedAt = ?
     WHERE id = ? AND useCount < ?`,
  ).run(maxUses, userId, pbNow(), inviteId, maxUses);
  return (result.changes ?? 0) > 0;
}
