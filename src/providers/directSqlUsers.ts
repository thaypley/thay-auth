/**
 * Direct-SQL user insert — bypass for the broken PocketBase admin
 * `POST /api/collections/users/records` endpoint.
 *
 * Writes a fully-shaped `users` row into `pb_data/data.db` so that PB's
 * Go auth verifier (which only reads `users.email` + `users.password`)
 * accepts the new user on the next `authWithPassword` call.
 *
 * Gated behind `DIRECT_SQL_USERS=1` so the admin path remains the
 * default. When the flag is off, this module is never imported and
 * PB's own API is used.
 *
 * Schema invariants (verified against the live `hcgi/platform` db):
 *   - id: PB default 15-char lower-alnum (e.g. `ht30cxp718xc97o`)
 *   - tokenKey: 50-char opaque, must be unique (UNIQUE INDEX)
 *   - password: `$2a$10$...` bcrypt (60 chars total)
 *   - email/username: UNIQUE INDEX
 *   - isVerified/isArchitect/verified: BOOLEAN 0|1
 *   - created/updated: RFC3339 strings
 *
 * The created/updated timestamps are written as ISO strings matching
 * PB's Go time.Format("2006-01-02T15:04:05.000Z07:00") output.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { hashPasswordBcrypt } from '../utils/bcrypt.js';
import { logger } from '../utils/logger.js';

const PB_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_KEY_LEN = 50;

function pbId(): string {
  const bytes = crypto.randomBytes(15);
  let s = '';
  for (let i = 0; i < 15; i++) s += PB_ID_ALPHABET[bytes[i] % PB_ID_ALPHABET.length];
  return s;
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

  // Field map: app-level semantic → db column. We introspect the live
  // schema so the insert works against any `users` table that has the
  // core auth fields (id, email, password, tokenKey), ignoring
  // app-specific columns the local db might be missing.
  const wanted: Array<[string, string | number | null]> = [
    ['id', id],
    ['email', input.email],
    ['username', input.username],
    ['password', passwordHash],
    ['tokenKey', tk],
    ['accountType', input.accountType],
    ['birthday', input.birthday],
    ['age', input.age],
    ['tier', tier],
    ['isVerified', isVerified],
    ['isArchitect', 0],
    ['verified', 0],
    ['emailVisibility', 0],
    ['avatar', ''],
    ['name', ''],
    ['emailVerificationCode', ''],
    ['emailVerificationCodeExpiry', ''],
    ['lastUsernameChangeAt', ''],
    ['created', now],
    ['updated', now],
  ];

  const db = new DatabaseSync(dbPath, { readOnly: false });
  try {
    const cols = (db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    const colSet = new Set(cols);
    const present = wanted.filter(([name]) => colSet.has(name));
    if (present.length === 0) throw new Error('no usable columns in users table');
    if (!colSet.has('password')) throw new Error('users table missing required `password` column');
    if (!colSet.has('email')) throw new Error('users table missing required `email` column');

    const names = present.map(([n]) => n).join(', ');
    const placeholders = present.map(([n]) => '@' + n).join(', ');
    const params: Record<string, string | number | null> = {};
    for (const [n, v] of present) params[n] = v;

    const sql = `INSERT INTO users (${names}) VALUES (${placeholders})`;
    db.prepare(sql).run(params);
  } catch (err) {
    db.close();
    logger.error('direct-sql user insert failed:', err);
    throw err;
  }
  db.close();

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
