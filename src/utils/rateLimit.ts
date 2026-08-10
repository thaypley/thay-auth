import { Request, Response, NextFunction } from 'express';
import LRUCache from 'lru-cache';
import { config } from '../config.js';
import { metrics } from '../utils/metrics.js';

/**
 * SLIDING WINDOW RATE LIMITER
 *
 * Original problems fixed here:
 *  1. UNBOUNDED MEMORY: the old store was `Map<string, number[]>` with no
 *     key cap. Spoofed XFF headers (see #3) could grow it without limit —
 *     a memory-exhaustion vector. Now every limiter's key space is an LRU
 *     capped at 50k keys with a TTL of its own window.
 *  2. O(n) GLOBAL CLEANUP: the old code scanned every key every 60s.
 *     LRU eviction is amortized O(1); no sweep needed.
 *  3. SPOOFABLE IDENTIFIER: `trust proxy: 1` + client-supplied
 *     X-Forwarded-For let a client choose its own rate-limit key. Fixed at
 *     the server by defaulting to trust proxy 'loopback' (see config.ts).
 *  4. BOGUS RETRY-AFTER: `(windowStart - now)/1000` is always negative.
 *     Now computed from the oldest in-window timestamp.
 *
 * Horizontal scale: with REDIS_URL set, the store is a shared Redis
 * sliding window (sorted set) so N replicas enforce ONE limit. Redis
 * failures fail OPEN — rate limiting must degrade, never take auth down.
 */

interface RateLimitStore {
  allow(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; retryAfterSec: number }>;
}

class MemoryStore implements RateLimitStore {
  private cache: LRUCache<string, number[]>;

  constructor() {
    // Per-key arrays are bounded by `max` after pruning; the key space
    // is bounded by this LRU. TTL = longest window in the app (15 min).
    this.cache = new LRUCache<string, number[]>({ max: 50000, ttl: 15 * 60 * 1000 });
  }

  async allow(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entries = this.cache.get(key);
    if (!entries) entries = [];

    // Timestamps are pushed in non-decreasing order, so the prefix below
    // windowStart is contiguous — prune from the head, O(k) where k ≤ max.
    if (entries.length > 0 && entries[0] < windowStart) {
      let keep = 0;
      while (keep < entries.length && entries[keep] < windowStart) keep++;
      if (keep > 0) entries = keep === entries.length ? [] : entries.slice(keep);
    }

    if (entries.length >= max) {
      // Oldest surviving timestamp determines when the window frees up.
      const retryAfterSec = Math.max(1, Math.ceil((entries[0] + windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }

    entries.push(now);
    this.cache.set(key, entries);
    return { allowed: true, retryAfterSec: 0 };
  }
}

class RedisStore implements RateLimitStore {
  private redis: any = null;
  private connectPromise: Promise<any> | null = null;
  private seq = 0;

  private async client(): Promise<any> {
    if (this.redis) return this.redis;
    if (!this.connectPromise) {
      // Lazy dynamic import — ioredis is only loaded when REDIS_URL is set.
      this.connectPromise = (async () => {
        const { default: Redis } = await import('ioredis');
        const client = new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        await client.connect();
        this.redis = client;
        return client;
      })();
    }
    return this.connectPromise;
  }

  async allow(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
    try {
      const redis = await this.client();
      const now = Date.now();
      const min = now - windowMs;
      const member = `${now}:${this.seq++}`;

      const results = await redis
        .multi()
        .zremrangebyscore(key, 0, min)
        .zadd(key, now, member)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec();
      const count = (results?.[2]?.[1] as number) ?? 0;

      if (count > max) {
        const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTs = oldest?.[1] ? Number(oldest[1]) : now;
        const retryAfterSec = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
        return { allowed: false, retryAfterSec };
      }
      return { allowed: true, retryAfterSec: 0 };
    } catch {
      metrics.inc('thay_auth_ratelimit_errors_total', { store: 'redis' });
      return { allowed: true, retryAfterSec: 0 }; // fail open
    }
  }
}

let sharedStore: RateLimitStore | null = null;
function getStore(): RateLimitStore {
  if (!sharedStore) {
    sharedStore = config.redisUrl ? new RedisStore() : new MemoryStore();
  }
  return sharedStore;
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
  const store = getStore();

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = identifierFn(req);
    const key = `${keyPrefix}:${identifier}`;

    const { allowed, retryAfterSec } = await store.allow(key, windowMs, max);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSec));
      metrics.inc('thay_auth_ratelimit_rejected_total', { prefix: keyPrefix });
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
