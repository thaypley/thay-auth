import LRUCache from 'lru-cache';
import { getRedis } from './redis.js';
import { metrics } from './metrics.js';

/**
 * Two-tier cache: in-process LRU (L1) + shared Redis (L2).
 *
 * L1 serves the hot path with zero I/O. L2 gives cross-replica
 * propagation: a logout/revoke on replica A is visible to replicas B/C
 * within one Redis GET (~0.3ms) on their next local miss — closing the
 * ≤TTL revocation-latency window that a per-instance cache alone leaves
 * open. When Redis is not configured, this is exactly a local LRU.
 *
 * Writes are fire-and-forget (never block the hot path); only the
 * local-miss L2 read is awaited. Redis failures resolve as "no data" —
 * the source of truth remains PocketBase.
 */

export class SharedCache<T> {
  private local: LRUCache<string, T>;

  constructor(private readonly opts: { max: number; ttlMs: number; prefix: string; name: string }) {
    this.local = new LRUCache<string, T>({ max: opts.max, ttl: opts.ttlMs });
  }

  get size(): number {
    return this.local.size;
  }

  /** L1 lookup — synchronous, zero I/O. */
  get(key: string): T | undefined {
    return this.local.get(key);
  }

  /** L2 lookup on local miss. Resolves undefined when Redis is off. */
  async getRemote(key: string): Promise<T | undefined> {
    const redis = await getRedis();
    if (!redis) return undefined;
    try {
      const raw = await redis.get(`${this.opts.prefix}:${key}`);
      if (raw === null) return undefined;
      const value = JSON.parse(raw) as T;
      metrics.inc('thay_auth_cache_hits_total', { cache: `${this.opts.name}-remote` });
      return value;
    } catch {
      metrics.inc('thay_auth_redis_errors_total', { op: 'get' });
      return undefined;
    }
  }

  /** Write-through: local synchronously, Redis fire-and-forget. */
  set(key: string, value: T): void {
    this.local.set(key, value);
    void getRedis()
      .then((redis) => {
        if (!redis) return;
        return redis
          .set(`${this.opts.prefix}:${key}`, JSON.stringify(value), 'PX', this.opts.ttlMs)
          .catch(() => metrics.inc('thay_auth_redis_errors_total', { op: 'set' }));
      })
      .catch(() => {});
  }

  /** Invalidate on both tiers (revoke/unpair fast-path). */
  del(key: string): void {
    this.local.delete(key);
    void getRedis()
      .then((redis) => {
        if (!redis) return;
        return redis.del(`${this.opts.prefix}:${key}`).catch(() => metrics.inc('thay_auth_redis_errors_total', { op: 'del' }));
      })
      .catch(() => {});
  }
}
