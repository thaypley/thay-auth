import 'dotenv/config';

function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

// Fail fast rather than silently signing tokens with a known default. A
// missing secret in prod would otherwise let anyone forge valid device
// JWTs — this must never fall back quietly.
const jwtSecret = process.env.THAY_AUTH_JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  throw new Error(
    'THAY_AUTH_JWT_SECRET is missing or too short (min 16 chars). ' +
    'Set it in your environment before starting thay-auth — refusing to boot with an insecure default.',
  );
}

export const config = {
  port: parseInt(process.env.PORT || '3749', 10),

  pbUrl: process.env.PB_URL || 'http://127.0.0.1:8090',
  pbAdminEmail: process.env.PB_ADMIN_EMAIL || '',
  pbAdminPassword: process.env.PB_ADMIN_PASSWORD || '',

  jwtSecret,

  /**
   * Express trust proxy. Default 'loopback' is spoof-safe: only the
   * nginx hop on 127.0.0.1 is trusted, so req.ip is always the real
   * client IP even when a client forges X-Forwarded-For (which the old
   * `trust proxy: 1` accepted — the rate limiter key was spoofable and
   * the key map was fillable with fake IPs). Set TRUST_PROXY=1 only if
   * nginx is NOT on the same host.
   */
  trustProxy: (process.env.TRUST_PROXY ?? 'loopback') as unknown,

  // Allow the thaypley desktop apps (thay-studio et al.) to authenticate.
  // Vite/Tauri dev serves on 1420; packaged apps run in a Tauri webview.
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://localhost:3749,' +
    'http://localhost:1420,http://127.0.0.1:1420,' +
    'tauri://localhost,http://tauri.localhost'
  ).split(','),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@thaypley.com',
  },

  invite: {
    codePrefix: process.env.INVITE_CODE_PREFIX || 'TP',
    defaultMaxUses: parseInt(process.env.INVITE_DEFAULT_MAX_USES || '1', 10),
  },

  // Bypass the broken PB admin `POST /api/collections/users/records` by
  // writing directly to PB's `pb_data/data.db`. With the data dir bind-
  // mounted at /pb_data (see docker-compose.yml) and DIRECT_SQL_USERS=1,
  // PB's Go auth verifier reads the new row on the next
  // authWithPassword call. Requires python3+bcrypt inside the image.
  directSqlUsers: process.env.DIRECT_SQL_USERS === '1',
  pbDataPath: process.env.PB_DATA_PATH || '/pb_data/data.db',

  // Public base of the PocketBase instance, used to build browser-reachable
  // file URLs (avatars). The internal pbUrl is host-local only.
  pbPublicUrl: (process.env.PB_PUBLIC_URL || 'https://thaypley.com').replace(/\/+$/, ''),

  // Token expiry — 30 days per segment. THE single source of truth for
  // session AND device token lifetimes.
  tokenExpiryMs: Number(process.env.TOKEN_EXPIRY_MS) || 30 * 24 * 60 * 60 * 1000,

  // Verification code expiry — 15 minutes.
  verificationCodeExpiryMs: 15 * 60 * 1000,

  // ── Performance / scale knobs (tuned for the 256MB docker cap) ──

  cache: {
    // L1 verified-token cache. Value is a slimmed user record (~400B),
    // key is sha256(token) (64 hex chars vs ~800B raw token): 20k
    // entries ≈ 12-14MB incl. LRU overhead. Sizing on memory budget:
    // 20k tokens is the working set of ACTIVE sessions on one replica.
    tokenMax: intEnv('TOKEN_CACHE_MAX', 20000),
    tokenTtlMs: intEnv('TOKEN_CACHE_TTL_MS', 30 * 24 * 60 * 60 * 1000),

    userMax: intEnv('USER_CACHE_MAX', 2000),
    userTtlMs: intEnv('USER_CACHE_TTL_MS', 60000),

    revocationMax: intEnv('REVOCATION_CACHE_MAX', 20000),
    revocationTtlMs: intEnv('REVOCATION_CACHE_TTL_MS', 60000),
  },

  /**
   * Session-revocation failure policy. When the revocation lookup errors
   * (PB down / timeout):
   *   'closed' (default) → treat as revoked → 401. Secure, but a PB
   *     outage becomes a mass-401 storm + client retry feedback loop.
   *   'open' → treat as not revoked → request proceeds. Keeps auth
   *     serving during PB degradation; a revoked session can be used
   *     until the revocation cache TTL (60s) refreshes. Set
   *     REVOCATION_FAIL_POLICY=open when PB uptime is the priority.
   */
  revocationFailPolicy: process.env.REVOCATION_FAIL_POLICY === 'open' ? 'open' : 'closed',

  // Public catalog (no auth) — L1 stale-while-revalidate cache.
  catalogCacheTtlMs: intEnv('CATALOG_CACHE_TTL_MS', 60000),

  // /me + /profile per-user cache; invalidated on user-mutating routes.
  // 10k × ~1.2KB ≈ 12MB — sized for the 256MB container; raise with
  // PROFILE_CACHE_MAX when the container cap grows.
  profileCacheMax: intEnv('PROFILE_CACHE_MAX', 10000),
  profileCacheTtlMs: intEnv('PROFILE_CACHE_TTL_MS', 30000),

  // Device verification cache + lastSeen write throttle.
  deviceCacheMax: intEnv('DEVICE_CACHE_MAX', 50000),
  deviceCacheTtlMs: intEnv('DEVICE_CACHE_TTL_MS', 60000),
  deviceLastSeenThrottleMs: intEnv('DEVICE_LASTSEEN_THROTTLE_MS', 5 * 60 * 1000),

  // Fire-and-forget session audit writes.
  sessionQueueConcurrency: intEnv('SESSION_QUEUE_CONCURRENCY', 16),
  sessionQueueMax: intEnv('SESSION_QUEUE_MAX', 5000),

  // bcrypt worker pool (signup hashing off the event loop). 0 = auto:
  // min(max(2, cores-1), 4). Queue overflow falls back to inline bcryptjs.
  bcryptWorkers: intEnv('BCRYPT_WORKERS', 0),
  bcryptMaxQueue: intEnv('BCRYPT_MAX_QUEUE', 64),

  // Optional Redis for horizontally-shared rate limiting. Empty = in-memory.
  redisUrl: process.env.REDIS_URL || '',
};
