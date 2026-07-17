import 'dotenv/config';

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

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3749').split(','),

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
  pbPublicUrl: (process.env.PB_PUBLIC_URL || 'https://thaypley.com/hcgi/platform').replace(/\/+$/, ''),
};
