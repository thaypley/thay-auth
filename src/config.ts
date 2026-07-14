import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3749', 10),

  pbUrl: process.env.PB_URL || 'http://127.0.0.1:8090',
  pbAdminEmail: process.env.PB_ADMIN_EMAIL || '',
  pbAdminPassword: process.env.PB_ADMIN_PASSWORD || '',

  jwtSecret: process.env.THAY_AUTH_JWT_SECRET || 'dev-secret-change-in-production',

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
};
