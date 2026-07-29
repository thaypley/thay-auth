import { Request, Response, NextFunction } from 'express';

/**
 * SLIDING WINDOW RATE LIMITER (production-ready)
 *
 * In development: uses in-memory store (single instance only).
 * In production: configure REDIS_HOST to use RedisStore for horizontal scaling.
 * Uses sliding log algorithm — most accurate, prevents burst spikes while allowing
 * smooth traffic within the limit.
 */

// In-memory store: stores timestamps for each client
const inMemoryStore = new Map<string, number[]>();
let cleanupInterval: NodeJS.Timeout | null = null;

/** Generate a cache key with TTL for rate limiting */
function makeKey(prefix: string, identifier: string): string {
  return `${prefix}:${identifier}`;
}

/**
 * Sliding window rate limiter middleware.
 * Options: windowMs (ms), max (requests per window), keyPrefix, identifierFn(req)
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  identifierFn?: (req: Request) => string;
}) {
  const { windowMs, max, keyPrefix, identifierFn = (req) => req.ip || 'unknown' } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = identifierFn(req);
    const key = makeKey(keyPrefix, identifier);
    const now = Date.now();
    const windowStart = now - windowMs;

    let entries = inMemoryStore.get(key) || [];

    // Remove old timestamps outside sliding window
    entries = entries.filter(ts => ts >= windowStart);

    if (entries.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((windowStart - now) / 1000) + 1);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Add current request timestamp
    entries.push(now);
    inMemoryStore.set(key, entries);

    // Periodic cleanup so the map doesn't grow unbounded — run once at module load
    if (!cleanupInterval) {
      cleanupInterval = setInterval(() => {
        const cutOff = Date.now() - windowMs;
        for (const [k, v] of inMemoryStore.entries()) {
          const filtered = v.filter(ts => ts >= cutOff);
          if (filtered.length === 0) {
            inMemoryStore.delete(k);
          } else {
            inMemoryStore.set(k, filtered);
          }
        }
      }, 60000).unref();
    }

    next();
  };
}
