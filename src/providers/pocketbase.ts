import PocketBase from 'pocketbase';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import LRUCache from 'lru-cache';
import { escapePbFilterValue } from '../utils/filterEscape.js';

const escapeFilterValue = escapePbFilterValue;

// Node.js 18+ uses HTTP keep-alive by default, so each PocketBase
// instance reuses its TCP connections internally. No extra agent needed.

let adminPb: PocketBase | null = null;
let lastAuthTime = 0;
const AUTH_REFRESH_MS = 25 * 60 * 1000;

export function createClient(url?: string): PocketBase {
  return new PocketBase(url || config.pbUrl);
}

export async function getAdminPb(): Promise<PocketBase> {
  // Fast path: already authenticated within window
  if (adminPb && Date.now() - lastAuthTime < AUTH_REFRESH_MS) {
    return adminPb;
  }

  // Double-checked lock: create fresh instance only if needed
  const now = Date.now();
  if (adminPb && now - lastAuthTime < AUTH_REFRESH_MS) {
    return adminPb;
  }

  const pb = new PocketBase(config.pbUrl);
  try {
    await pb.admins.authWithPassword(config.pbAdminEmail, config.pbAdminPassword);
    adminPb = pb;
    lastAuthTime = now;
    logger.info('Admin PocketBase client authenticated');
    return pb;
  } catch (err) {
    logger.error('Failed to authenticate admin PocketBase client:', err);
    // Return previous client if available — better than failing entirely
    if (adminPb) {
      logger.warn('Using stale admin client due to auth failure');
      return adminPb;
    }
    throw err;
  }
}

// ============================
// Token verification cache (L1 in-process cache)
// ============================

const tokenCache = new LRUCache<string, { user: Record<string, unknown>; expiresAt: number }>({
  max: 50000,           // ~50k cached tokens
  ttl: 30 * 24 * 60 * 60 * 1000, // up to 30 days (matches token expiry)
  dispose: (_value, _key) => { /* optional cleanup hook */ },
});

/**
 * verifyUserToken — reuses pooled client + caches verified tokens.
 * Avoids network call for subsequent refreshes within the same session window.
 */
export async function verifyUserToken(token: string): Promise<{ user: Record<string, unknown>; pb: PocketBase } | null> {
  // Check L1 cache first — serves most frequent case (token refresh within window)
  const cached = tokenCache.get(token);
  if (cached) {
    const now = Date.now();
    if (now < cached.expiresAt) {
      // Reuse an existing PB client (either fresh or stale)
      const pb = adminPb || createClient();
      return { user: cached.user, pb };
    } else {
      // Stale cache entry — remove it
      tokenCache.delete(token);
    }
  }

  try {
    const pb = createClient(); // Use pooled client
    pb.authStore.save(token, null);
    const authData = await pb.collection('users').authRefresh();

    // Compute actual expiry from the JWT token payload
    let expiresIn = config.tokenExpiryMs;
    try {
      const payload = JSON.parse(Buffer.from(authData.token.split('.')[1], 'base64').toString());
      if (payload.exp) {
        expiresIn = Math.min(payload.exp * 1000 - Date.now(), config.tokenExpiryMs);
      }
    } catch { /* fallback to default expiry */ }
    const expiresAt = Date.now() + Math.max(expiresIn, 60000); // at least 1 minute

    // Cache the result for future reuse
    tokenCache.set(token, { user: authData.record as unknown as Record<string, unknown>, expiresAt });

    return { user: authData.record as unknown as Record<string, unknown>, pb };
  } catch (err) {
    logger.debug('Token verification failed', err);
    tokenCache.delete(token); // Invalidate on any failure
    return null;
  }
}

// ============================
// User lookup cache (L1 by email/username)
// ============================

const userLookupCache = new LRUCache<string, Record<string, unknown> | null>({
  max: 10000,             // 10k cached lookups
  ttl: 60000,             // 1 minute TTL
});

export async function findUserByEmail(email: string): Promise<Record<string, unknown> | null> {
  const key = email.toLowerCase().trim();
  const cached = userLookupCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const pb = await getAdminPb();
    const escaped = escapeFilterValue(email);
    const result = await pb.collection('users').getList(1, 1, {
      filter: `email=${escaped}`,
    });
    const found = result.items[0] as unknown as Record<string, unknown> || null;
    userLookupCache.set(key, found);
    return found;
  } catch (err) {
    logger.warn('findUserByEmail error', err);
    userLookupCache.set(key, null); // Cache miss as negative
    return null;
  }
}

export async function findUserByUsername(username: string): Promise<Record<string, unknown> | null> {
  const key = username.toLowerCase().trim();
  const cached = userLookupCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const pb = await getAdminPb();
    const escaped = escapeFilterValue(username);
    const result = await pb.collection('users').getList(1, 1, {
      filter: `username=${escaped}`,
    });
    const found = result.items[0] as unknown as Record<string, unknown> || null;
    userLookupCache.set(key, found);
    return found;
  } catch (err) {
    logger.warn('findUserByUsername error', err);
    userLookupCache.set(key, null);
    return null;
  }
}


