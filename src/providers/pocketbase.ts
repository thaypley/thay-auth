import PocketBase from 'pocketbase';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { hashToken } from '../utils/hashToken.js';
import { escapePbFilterValue } from '../utils/filterEscape.js';
import LRUCache from 'lru-cache';

/**
 * PocketBase client management, optimized for the verified-token hot path.
 *
 * Critical SDK fact: the JS SDK's `send()` auto-cancels the previous
 * in-flight request that shares a requestKey (default: method + path).
 * Two concurrent calls to the SAME client with the same path abort each
 * other. The original code "avoided" this by creating a fresh client per
 * verify — an allocation per cache miss. All shared clients here call
 * `autoCancellation(false)` so a pooled client is safe under concurrency.
 */

const escapeFilterValue = escapePbFilterValue;

// ── Admin client (pooled, mutex-protected auth, fast-fail circuit) ──

const AUTH_REFRESH_MS = 25 * 60 * 1000;
const AUTH_FAIL_FAST_MS = 5000;

let adminPb: PocketBase | null = null;
let lastAuthAt = 0;
let lastAuthFailureAt = 0;
let authPromise: Promise<PocketBase> | null = null;

export function createClient(url?: string): PocketBase {
  const pb = new PocketBase(url || config.pbUrl);
  // Per-call clients must not auto-cancel either: e.g. two concurrent
  // /auth/refresh calls on separate clients are fine, but a login and a
  // signup hitting the same path on the same client would abort.
  pb.autoCancellation(false);
  return pb;
}

export async function getAdminPb(): Promise<PocketBase> {
  const now = Date.now();
  if (adminPb && now - lastAuthAt < AUTH_REFRESH_MS) {
    return adminPb;
  }

  // Fail-fast circuit: while admin auth is failing, don't hammer PB with
  // an auth attempt on every request. Serve the stale client if one
  // exists (its calls will 401 and surface via pb_errors metrics), and
  // retry auth at most every 5s.
  if (lastAuthFailureAt !== 0 && now - lastAuthFailureAt < AUTH_FAIL_FAST_MS) {
    if (adminPb) return adminPb;
    throw new Error('PB admin auth failing (circuit open)');
  }

  // Single-flight: concurrent cold calls share ONE auth attempt instead
  // of each re-authenticating (the old code's "double-checked lock" had
  // an await between check and set, so N concurrent requests created N
  // clients and N auth calls).
  if (!authPromise) {
    authPromise = (async () => {
      const pb = new PocketBase(config.pbUrl);
      pb.autoCancellation(false);
      await pb.admins.authWithPassword(config.pbAdminEmail, config.pbAdminPassword);
      adminPb = pb;
      lastAuthAt = Date.now();
      lastAuthFailureAt = 0;
      return pb;
    })().catch((err: unknown) => {
      authPromise = null;
      lastAuthFailureAt = Date.now();
      metrics.inc('thay_auth_pb_errors_total', { op: 'adminAuth' });
      logger.error('Failed to authenticate admin PocketBase client:', err);
      if (adminPb) return adminPb; // degraded: stale token, ops will 401
      throw err;
    });
  }
  return authPromise;
}

// ── Shared verification client ─────────────────────────────────────
// One pooled client for authRefresh calls (auto-cancellation disabled).
// Safe under concurrency because the SDK reads authStore.token
// synchronously at send()-time, and each caller saves its own token
// immediately before the call.

let verifyPb: PocketBase | null = null;

export function getVerifyClient(): PocketBase {
  if (!verifyPb) {
    verifyPb = createClient();
  }
  return verifyPb;
}

// ── Verified-token cache (L1) ──────────────────────────────────────
// Key = sha256(token) (64 hex chars) instead of the raw ~800B token:
// 20k keys ≈ 1.3MB vs ~16MB, and a leaked cache contains no tokens.
// Value = slimmed user record (~400B) rather than the full PB record.

export interface CachedUser {
  id: string;
  email: string;
  username: string;
  accountType: string;
  isVerified: boolean;
  isArchitect: boolean;
  tier: string;
  avatar: string;
  birthday: string;
  created: string;
  updated: string;
}

const tokenCache = new LRUCache<string, { user: CachedUser; expiresAt: number }>({
  max: config.cache.tokenMax,
  ttl: config.cache.tokenTtlMs,
});

const tokenInflight = new Map<string, Promise<{ user: CachedUser; expiresAt: number } | null>>();
const MAX_INFLIGHT = 10000;

/**
 * Cold-start semaphore: a fresh instance receiving thousands of distinct
 * first-time tokens must not fire thousands of concurrent authRefresh
 * calls at PB. Bounded to PB_VERIFY_CONCURRENCY (default 32) in-flight
 * verifies; the rest queue microtask-style (zero timers).
 */
const VERIFY_CONCURRENCY = Math.max(4, parseInt(process.env.PB_VERIFY_CONCURRENCY || '32', 10) || 32);
let verifyRunning = 0;
const verifyWaiters: Array<() => void> = [];

function acquireVerify(): Promise<void> {
  if (verifyRunning < VERIFY_CONCURRENCY) {
    verifyRunning += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => verifyWaiters.push(resolve));
}

function releaseVerify(): void {
  const next = verifyWaiters.shift();
  if (next) {
    next();
  } else {
    verifyRunning -= 1;
  }
}

function slimUser(record: Record<string, unknown>): CachedUser {
  // Explicit field picks only — never spread the whole record (it can
  // carry app-specific blobs that would bloat every cache entry).
  return {
    id: (record.id as string) || '',
    email: (record.email as string) || '',
    username: (record.username as string) || '',
    accountType: (record.accountType as string) || '',
    isVerified: !!record.isVerified,
    isArchitect: !!record.isArchitect,
    tier: (record.tier as string) || 'free',
    avatar: (record.avatar as string) || '',
    birthday: (record.birthday as string) || '',
    created: (record.created as string) || '',
    updated: (record.updated as string) || '',
  };
}

function computeExpiresAt(freshToken: string): number {
  // Real expiry from the JWT payload — avoids trusting a mirrored constant.
  try {
    const payload = JSON.parse(Buffer.from(freshToken.split('.')[1] || '', 'base64url').toString());
    if (payload && typeof payload.exp === 'number') {
      const ms = Math.min(payload.exp * 1000 - Date.now(), config.tokenExpiryMs);
      return Date.now() + Math.max(ms, 60000);
    }
  } catch {
    /* fall through to default expiry */
  }
  return Date.now() + config.tokenExpiryMs;
}

async function doVerify(token: string): Promise<{ user: CachedUser; expiresAt: number } | null> {
  const pb = getVerifyClient();
  await acquireVerify();
  try {
    pb.authStore.save(token, null);
    const authData = await pb.collection('users').authRefresh();
    return {
      user: slimUser(authData.record as unknown as Record<string, unknown>),
      expiresAt: computeExpiresAt(authData.token),
    };
  } catch {
    metrics.inc('thay_auth_pb_errors_total', { op: 'authRefresh' });
    return null;
  } finally {
    releaseVerify();
  }
}

export async function verifyUserToken(token: string): Promise<{ user: CachedUser; pb: PocketBase } | null> {
  const key = hashToken(token);

  const cached = tokenCache.get(key);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      metrics.inc('thay_auth_cache_hits_total', { cache: 'token' });
      return { user: cached.user, pb: getVerifyClient() };
    }
    tokenCache.delete(key);
  }
  metrics.inc('thay_auth_cache_misses_total', { cache: 'token' });

  // Single-flight: a cold cache (deploy, restart, spike) must not turn
  // into an authRefresh stampede — one in-flight verify per unique token.
  let inflight = tokenInflight.get(key);
  if (!inflight) {
    if (tokenInflight.size >= MAX_INFLIGHT) {
      // Extremely unlikely; fall back to a direct verify rather than
      // queueing behind thousands of distinct tokens.
      const result = await doVerify(token);
      if (result) tokenCache.set(key, result);
      return result ? { user: result.user, pb: getVerifyClient() } : null;
    }
    inflight = doVerify(token).finally(() => tokenInflight.delete(key));
    tokenInflight.set(key, inflight);
  }

  const result = await inflight;
  if (result) {
    tokenCache.set(key, result);
    return { user: result.user, pb: getVerifyClient() };
  }
  tokenCache.delete(key);
  return null;
}

// ── User lookup cache (L1 by email/username) ───────────────────────

const userLookupCache = new LRUCache<string, Record<string, unknown> | null>({
  max: config.cache.userMax,
  ttl: config.cache.userTtlMs,
});

export async function findUserByEmail(email: string): Promise<Record<string, unknown> | null> {
  const key = email.toLowerCase().trim();
  const cached = userLookupCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const pb = await getAdminPb();
    const escaped = escapeFilterValue(key);
    const result = await pb.collection('users').getList(1, 1, {
      filter: `email=${escaped}`,
    });
    const found = (result.items[0] as unknown as Record<string, unknown>) || null;
    userLookupCache.set(key, found);
    return found;
  } catch (err) {
    metrics.inc('thay_auth_pb_errors_total', { op: 'findUserByEmail' });
    logger.warn('findUserByEmail error', err);
    userLookupCache.set(key, null); // negative cache — avoids repeat probes
    return null;
  }
}

export async function findUserByUsername(username: string): Promise<Record<string, unknown> | null> {
  const key = username.toLowerCase().trim();
  const cached = userLookupCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const pb = await getAdminPb();
    const escaped = escapeFilterValue(key);
    const result = await pb.collection('users').getList(1, 1, {
      filter: `username=${escaped}`,
    });
    const found = (result.items[0] as unknown as Record<string, unknown>) || null;
    userLookupCache.set(key, found);
    return found;
  } catch (err) {
    metrics.inc('thay_auth_pb_errors_total', { op: 'findUserByUsername' });
    logger.warn('findUserByUsername error', err);
    userLookupCache.set(key, null);
    return null;
  }
}
