import { Request, Response, NextFunction } from 'express';
import type PocketBase from 'pocketbase';
import { verifyUserToken } from '../providers/pocketbase.js';
import { verifyUserToken as verifyWrappedUserToken, verifyDeviceToken } from '../providers/jwt.js';
import { hashToken } from '../utils/hashToken.js';
import { logger } from '../utils/logger.js';
import { AppSlug } from '../utils/apps.js';
import LRUCache from 'lru-cache'; // npm i lru-cache

// ============================
// Session revocation cache (L1)
// ============================
// Checks token -> revoked status. Reduces repeated PB calls for same token.
const sessionRevocationCache = new LRUCache<string, boolean>({
  max: 20000,           // ~20k entries
  ttl: 60000,           // 1 minute TTL (short to detect revocations quickly)
});

export async function isSessionRevoked(pb: PocketBase, token: string): Promise<boolean> {
  const cacheKey = hashToken(token);
  const cached = sessionRevocationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const match = await pb.collection('sessions').getList(1, 1, {
      filter: `tokenHash="${cacheKey}"`,
    });
    // A session is revoked only when a matching row exists AND its `revoked`
    // flag is true. No row = pre-rollout token or session not recorded → not
    // revoked (fail open, matching pre-cache behavior). A live row with
    // revoked=false → not revoked.
    const isRevoked = match.items.length > 0 && !!((match.items[0] as unknown as Record<string, unknown>).revoked);
    sessionRevocationCache.set(cacheKey, isRevoked);
    return isRevoked;
  } catch (err) {
    logger.warn('Session revocation check failed', err);
    // Fail closed — treat error as potentially revoked (more secure)
    sessionRevocationCache.set(cacheKey, true);
    return true;
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

  // Wrapped thay-auth session token (aud-scoped, option a). Verify signature
  // locally first, then validate the inner PB token against PocketBase.
  const wrapped = verifyWrappedUserToken(token);
  if (wrapped) {
    // verifyUserToken now returns a PB client that can be reused
    const result = await verifyUserToken(wrapped.pbToken);
    if (!result) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const pb = result.pb;
    if (await isSessionRevoked(pb, wrapped.pbToken)) {
      return res.status(401).json({ error: 'Session revoked' });
    }
    req.pbToken = wrapped.pbToken;
    req.user = {
      id: wrapped.sub,
      email: result.user.email as string,
      username: result.user.username as string,
      aud: wrapped.aud,
      ...result.user,
    };
    return next();
  }

  // Legacy raw PB token path (pre-aud, keeps existing clients working).
  const result = await verifyUserToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Use the SAME PB client from verifyUserToken to avoid redundant auth
  const pb = result.pb;
  if (await isSessionRevoked(pb, token)) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  req.pbToken = token;
  req.user = {
    id: result.user.id as string,
    email: result.user.email as string,
    username: result.user.username as string,
    ...result.user,
  };
  next();
}

/**
 * requireUserForApp — requireUser plus per-app audience enforcement.
 * Tokens minted for a different app (aud mismatch) are rejected with 403.
 * Only applies to wrapped tokens; legacy raw PB tokens have no aud claim
 * and are treated as 'homebase' for backwards compatibility.
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

  verifyUserToken(token).then(result => {
    if (result) {
      req.user = {
        id: result.user.id as string,
        email: result.user.email as string,
        username: result.user.username as string,
        ...result.user,
      };
    }
    next();
  }).catch(() => next());
}
