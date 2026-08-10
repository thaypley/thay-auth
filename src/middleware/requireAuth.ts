import { Request, Response, NextFunction } from 'express';
import type PocketBase from 'pocketbase';
import { verifyUserToken } from '../providers/pocketbase.js';
import { verifyUserToken as verifyWrappedUserToken, verifyDeviceToken } from '../providers/jwt.js';
import { hashToken } from '../utils/hashToken.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { metrics } from '../utils/metrics.js';
import { AppSlug } from '../utils/apps.js';
import LRUCache from 'lru-cache';

// ============================
// Session revocation cache (L1)
// ============================
const sessionRevocationCache = new LRUCache<string, boolean>({
  max: config.cache.revocationMax,
  ttl: config.cache.revocationTtlMs,
});

let lastRevocationWarnAt = 0;

// Single-flight for revocation lookups: concurrent first-checks of the
// SAME token must share one PB query (mirrors the token cache's
// single-flight; a client retry burst can otherwise stampede PB).
const revocationInflight = new Map<string, Promise<boolean>>();

/**
 * Logout fast-path: mark a token's session revoked IMMEDIATELY on this
 * instance (bypasses the 60s revocation-cache TTL). The next request
 * with this token gets a 401 without a PB round trip.
 */
export function markSessionRevoked(token: string): void {
  sessionRevocationCache.set(hashToken(token), true);
}

/** Same, when only the stored tokenHash is known (sessions DELETE route). */
export function markSessionRevokedByHash(tokenHash: string): void {
  sessionRevocationCache.set(tokenHash, true);
}

export async function isSessionRevoked(pb: PocketBase, token: string): Promise<boolean> {
  const cacheKey = hashToken(token);
  const cached = sessionRevocationCache.get(cacheKey);
  if (cached !== undefined) {
    metrics.inc('thay_auth_cache_hits_total', { cache: 'revocation' });
    return cached;
  }
  metrics.inc('thay_auth_cache_misses_total', { cache: 'revocation' });

  let inflight = revocationInflight.get(cacheKey);
  if (!inflight) {
    inflight = doRevocationLookup(pb, cacheKey).finally(() => revocationInflight.delete(cacheKey));
    revocationInflight.set(cacheKey, inflight);
  }
  return inflight;
}

async function doRevocationLookup(pb: PocketBase, cacheKey: string): Promise<boolean> {
  try {
    const match = await pb.collection('sessions').getList(1, 1, {
      filter: `tokenHash="${cacheKey}"`,
    });
    // A session is revoked only when a matching row exists AND its
    // `revoked` flag is true. No row = pre-rollout token or session not
    // recorded → not revoked (fail open, matching pre-cache behavior).
    const isRevoked = match.items.length > 0 && !!((match.items[0] as unknown as Record<string, unknown>).revoked);
    sessionRevocationCache.set(cacheKey, isRevoked);
    return isRevoked;
  } catch (err) {
    metrics.inc('thay_auth_pb_errors_total', { op: 'sessionRevokedCheck' });
    // Throttle log spam — under a PB outage this path fires per request.
    const now = Date.now();
    if (now - lastRevocationWarnAt > 10000) {
      lastRevocationWarnAt = now;
      logger.warn(
        `Session revocation check failed (failing ${config.revocationFailPolicy === 'open' ? 'open' : 'closed'}):`,
        err,
      );
    }
    const value = config.revocationFailPolicy !== 'open'; // 'open' → false
    sessionRevocationCache.set(cacheKey, value);
    return value;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  aud?: AppSlug;
  [key: string]: unknown;
}

export interface AuthDevice {
  deviceId: string;
  userId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      device?: AuthDevice;
      /** The PocketBase JWT verified inside the (possibly wrapped) Bearer token. */
      pbToken?: string;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }

  // Wrapped thay-auth session token (aud-scoped). Verify signature
  // locally (3.5µs hand-rolled HMAC), then validate the inner PB token
  // against the L1 cache / PocketBase.
  const wrapped = verifyWrappedUserToken(token);
  if (wrapped) {
    const result = await verifyUserToken(wrapped.pbToken);
    if (!result) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (await isSessionRevoked(result.pb, wrapped.pbToken)) {
      return res.status(401).json({ error: 'Session revoked' });
    }
    req.pbToken = wrapped.pbToken;
    // Explicit field picks — the old `...result.user` spread allocated a
    // fresh object with every cached field on every request.
    req.user = {
      id: wrapped.sub,
      email: result.user.email,
      username: result.user.username,
      aud: wrapped.aud,
    };
    return next();
  }

  // Legacy raw PB token path (pre-aud, keeps existing clients working).
  const result = await verifyUserToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (await isSessionRevoked(result.pb, token)) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  req.pbToken = token;
  req.user = {
    id: result.user.id,
    email: result.user.email,
    username: result.user.username,
  };
  next();
}

/**
 * requireUserForApp — requireUser plus per-app audience enforcement.
 * Tokens minted for a different app (aud mismatch) are rejected with 403.
 */
export function requireUserForApp(allowed: AppSlug[]) {
  const allowedSet = new Set<string>(allowed);
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Empty token' });

    const wrapped = verifyWrappedUserToken(token);
    if (wrapped && !allowedSet.has(wrapped.aud)) {
      return res.status(403).json({ error: 'Token not valid for this app' });
    }

    return requireUser(req, res, next);
  };
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }

  const payload = verifyDeviceToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired device token' });
  }

  req.device = {
    deviceId: payload.deviceId,
    userId: payload.userId,
    scopes: payload.scopes,
  };
  next();
}

export function optionalUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) return next();

  verifyUserToken(token)
    .then((result) => {
      if (result) {
        req.user = {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
        };
      }
      next();
    })
    .catch(() => next());
}
