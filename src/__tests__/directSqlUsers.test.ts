import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createUserDirect,
  userExistsDirect,
  redeemInviteDirect,
  closeDirectSql,
  DuplicateFieldError,
} from '../providers/directSqlUsers.js';

// End-to-end through the sqlite worker (falls back to in-process if the
// runtime can't load the TS worker): real temp DB, real bcrypt, real CAS.

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'thay-auth-sqlite-'));
  dbPath = join(dir, 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT,
    tokenKey TEXT UNIQUE,
    accountType TEXT, birthday TEXT, age INTEGER, tier TEXT,
    isVerified INTEGER, isArchitect INTEGER, verified INTEGER, emailVisibility INTEGER,
    avatar TEXT, name TEXT, emailVerificationCode TEXT, emailVerificationCodeExpiry TEXT,
    lastUsernameChangeAt TEXT, created TEXT, updated TEXT
  )`);
  db.exec(`CREATE TABLE signup_invites (
    id TEXT PRIMARY KEY, useCount INTEGER, maxUses INTEGER, used INTEGER, usedBy TEXT, usedAt TEXT
  )`);
  db.exec(`INSERT INTO signup_invites (id, useCount, maxUses, used, usedBy, usedAt) VALUES ('inv1', 0, 1, 0, '', '')`);
  db.close();
});

afterAll(() => {
  closeDirectSql();
  rmSync(dir, { recursive: true, force: true });
});

describe('directSqlUsers (worker-backed)', () => {
  it('userExistsDirect reports fresh email/username as absent', async () => {
    const r = await userExistsDirect(dbPath, 'new@example.com', 'new_user');
    expect(r).toEqual({ email: false, username: false });
  });

  it('createUserDirect inserts a valid, bcrypt-hashed row', async () => {
    const user = await createUserDirect(dbPath, {
      email: 'a@example.com',
      password: 'password123',
      username: 'alice',
      accountType: 'lover',
      birthday: '1990-01-01',
      age: 35,
      isVerified: false,
      tier: 'free',
    });
    expect(user.id).toMatch(/^[a-z0-9]{15}$/);
    expect(user.email).toBe('a@example.com');
    expect(user.username).toBe('alice');

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT email, username, password, tokenKey FROM users WHERE id = ?').get(user.id);
    db.close();
    expect((row as Record<string, unknown>).email).toBe('a@example.com');
    expect((row as Record<string, unknown>).password).toMatch(/^\$2[abyx]\$\d+\$/);
    expect((row as Record<string, unknown>).tokenKey).toMatch(/^[A-Za-z0-9]{50}$/);
  });

  it('duplicate email surfaces a typed DuplicateFieldError (race path)', async () => {
    await expect(
      createUserDirect(dbPath, {
        email: 'a@example.com', // already taken above
        password: 'password123',
        username: 'bob',
        accountType: 'lover',
        birthday: '1990-01-01',
        age: 35,
      }),
    ).rejects.toBeInstanceOf(DuplicateFieldError);
  });

  it('userExistsDirect sees inserted rows', async () => {
    const r = await userExistsDirect(dbPath, 'a@example.com', 'nobody');
    expect(r.email).toBe(true);
    expect(r.username).toBe(false);
  });

  it('redeemInviteDirect is an atomic compare-and-swap', async () => {
    expect(await redeemInviteDirect(dbPath, 'inv1', 1, 'user-x')).toBe(true);
    // Exhausted: the WHERE useCount < maxUses guard must reject the second.
    expect(await redeemInviteDirect(dbPath, 'inv1', 1, 'user-y')).toBe(false);
  });
});
