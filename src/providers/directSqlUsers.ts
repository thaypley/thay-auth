/**
 * Direct-SQL user insert — bypass for the broken PocketBase admin
 * `POST /api/collections/users/records` endpoint.
 *
 * Writes a fully-shaped `users` row into `pb_data/data.db` so that PB's
 * Go auth verifier (which only reads `users.email` + `users.password`)
 * accepts the new user on the next `authWithPassword` call.
 *
 * Threading: ALL sqlite work runs in a dedicated worker thread. The
 * original implementation ran synchronous `node:sqlite` statements on
 * the main event loop — with `busy_timeout = 5000`, a write contended
 * with PB's own writer could stall every request in the process for
 * seconds. On the worker, that is invisible to the service.
 *
 * The client auto-detects worker availability (ping/pong handshake).
 * If the worker cannot start (e.g. Node < 22.13 without node:sqlite,
 * or a dev runtime that can't load TS workers), it falls back to
 * running the identical core logic in-process.
 */

import { Worker } from 'node:worker_threads';
import { hashPasswordBcrypt } from '../utils/bcrypt.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import {
  runOp,
  DuplicateFieldError,
  type DirectInsertInput,
  type DirectInsertResult,
} from '../utils/sqliteCore.js';

export { DuplicateFieldError, type DirectInsertInput, type DirectInsertResult };

const workerUrl = new URL(import.meta.url.endsWith('.ts') ? '../utils/sqliteWorker.ts' : '../utils/sqliteWorker.js', import.meta.url);

type Mode =
  | { kind: 'worker'; worker: Worker; seq: number; pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> }
  | { kind: 'inline' };

let modePromise: Promise<Mode> | null = null;
let inlineFallback = false;

function rehydrateError(err: { name?: string; message?: string; field?: string }): Error {
  if (err.name === 'DuplicateFieldError') {
    return new DuplicateFieldError((err.field as 'email' | 'username') || 'email');
  }
  return new Error(err.message || 'sqlite op failed');
}

async function initMode(): Promise<Mode> {
  try {
    const worker = new Worker(workerUrl);
    worker.unref();
    const mode: Mode = { kind: 'worker', worker, seq: 0, pending: new Map() };

    worker.on('message', (m) => {
      const p = mode.pending.get(m.id);
      if (!p) return;
      mode.pending.delete(m.id);
      if (m.pong) {
        p.resolve(undefined);
      } else if (m.error) {
        p.reject(rehydrateError(m.error));
      } else {
        p.resolve(m.result);
      }
    });
    worker.on('error', (err) => {
      // Worker died — reject in-flight ops and fall back to in-process.
      metrics.inc('thay_auth_worker_fallback_total', { module: 'sqlite' });
      logger.warn('sqlite worker error, falling back to in-process:', err);
      inlineFallback = true;
      for (const p of mode.pending.values()) p.reject(new Error('sqlite worker crashed'));
      mode.pending.clear();
      void worker.terminate();
    });

    // Readiness handshake — also surfaces module-load errors early.
    const pong = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 3000);
      const id = ++mode.seq;
      mode.pending.set(id, { resolve: () => resolve(true), reject: () => resolve(false) });
      worker.postMessage({ id, op: 'ping' });
      worker.once('error', () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    if (!pong) {
      void worker.terminate();
      inlineFallback = true;
      metrics.inc('thay_auth_worker_fallback_total', { module: 'sqlite' });
      return { kind: 'inline' };
    }
    return mode;
  } catch {
    inlineFallback = true;
    metrics.inc('thay_auth_worker_fallback_total', { module: 'sqlite' });
    return { kind: 'inline' };
  }
}

function getMode(): Promise<Mode> {
  if (inlineFallback) return Promise.resolve({ kind: 'inline' });
  if (!modePromise) modePromise = initMode();
  return modePromise;
}

async function request(op: string, payload: unknown): Promise<any> {
  const mode = await getMode();
  if (mode.kind === 'inline') {
    metrics.inc('thay_auth_sqlite_ops_total', { op, backend: 'inline' });
    return runOp(op, payload);
  }
  metrics.inc('thay_auth_sqlite_ops_total', { op, backend: 'worker' });
  return new Promise((resolve, reject) => {
    const id = ++mode.seq;
    mode.pending.set(id, { resolve, reject });
    mode.worker.postMessage({ id, op, payload });
  });
}

export async function createUserDirect(
  dbPath: string,
  input: DirectInsertInput,
): Promise<DirectInsertResult> {
  const passwordHash = await hashPasswordBcrypt(input.password);
  const isVerified = input.isVerified ? 1 : 0;
  const tier = input.tier || 'free';

  const result = await request('insert', {
    dbPath,
    email: input.email,
    username: input.username,
    password: passwordHash,
    accountType: input.accountType,
    disciplines: input.disciplines || '',
    birthday: input.birthday,
    age: input.age,
    isVerified,
    tier,
    name: input.name,
  });

  return {
    id: result.id,
    email: input.email,
    username: input.username,
    accountType: input.accountType,
    birthday: input.birthday,
    age: input.age,
    isVerified: !!isVerified,
    isArchitect: false,
    tier,
    avatar: '',
    created: result.created,
    updated: result.updated,
  };
}

/**
 * Fast-path duplicate check (before spending a bcrypt round, ~78ms).
 * The unique indexes are the real enforcement — this only short-circuits
 * the common case and returns a stable error message.
 */
export async function userExistsDirect(
  dbPath: string,
  email: string,
  username: string,
): Promise<{ email: boolean; username: boolean }> {
  return request('exists', { dbPath, email, username });
}

/**
 * Atomically redeem an invite (compare-and-swap on useCount) so two
 * concurrent signups with the same code can't both pass the check.
 */
export async function redeemInviteDirect(
  dbPath: string,
  inviteId: string,
  maxUses: number,
  userId: string,
): Promise<boolean> {
  return request('redeem', { dbPath, inviteId, maxUses, userId });
}

/** Close the pooled connection + worker on graceful shutdown. */
export function closeDirectSql(): void {
  if (!modePromise) return;
  void modePromise.then((mode) => {
    if (mode.kind !== 'worker') return;
    try {
      mode.worker.postMessage({ id: ++mode.seq, op: 'close', payload: {} });
    } catch {
      /* worker already terminated */
    }
    setTimeout(() => void mode.worker.terminate(), 100).unref();
  });
}
