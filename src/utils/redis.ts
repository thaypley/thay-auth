import { config } from '../config.js';
import { metrics } from './metrics.js';

/**
 * Lazy shared Redis client (single connection for rate limiting AND the
 * shared caches). Nothing loads unless REDIS_URL is configured: ioredis
 * is dynamically imported only on first use, and unconfigured calls
 * resolve to null instantly (zero cost, zero loaded code).
 *
 * Redis is a scale-out aid, never a hard dependency: every failure path
 * here resolves to null so callers degrade to local-only behavior.
 */

let redisClient: any = null;
let connectPromise: Promise<any | null> | null = null;

export function isRedisConfigured(): boolean {
  return !!config.redisUrl;
}

export function getRedis(): Promise<any | null> {
  if (!config.redisUrl) return Promise.resolve(null);
  if (redisClient) return Promise.resolve(redisClient);
  if (!connectPromise) {
    connectPromise = (async () => {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        keepAlive: 5000,
      });
      await client.connect();
      redisClient = client;
      return client;
    })().catch(() => {
      metrics.inc('thay_auth_redis_errors_total', { op: 'connect' });
      connectPromise = null;
      return null;
    });
  }
  return connectPromise;
}
