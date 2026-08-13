import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  createClient,
  getAdminPb,
  invalidateAdminPb,
  verifyUserToken as verifyPbUserToken,
} from '../providers/pocketbase.js';
import {
  createUserDirect,
  userExistsDirect,
  redeemInviteDirect,
  DuplicateFieldError,
} from '../providers/directSqlUsers.js';
import { signUserToken, verifyUserToken as verifyWrappedUserToken } from '../providers/jwt.js';
import { requireUser, requireArchitect, markSessionRevoked } from '../middleware/requireAuth.js';
import { OFFICIAL_PLATFORMS } from '../utils/platforms.js';
import { config } from '../config.js';
import {
  billingConfigured,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  verifyWebhook,
} from '../providers/billing.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { rateLimit } from '../utils/rateLimit.js';
import { hashToken } from '../utils/hashToken.js';
import { normalizeApp } from '../utils/apps.js';
import { BoundedQueue } from '../utils/asyncQueue.js';
import {
  validateEmail, validatePassword, validateUsername,
  validateBirthday, validateAccountType, validateInviteCode,
  sanitizeUsername,
} from '../utils/validate.js';
import { escapePbFilterValue } from '../utils/filterEscape.js';
import LRUCache from 'lru-cache';

const strictAuthLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'auth-strict' });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, keyPrefix: 'auth-login' });
const avatarLimit = rateLimit({ windowMs: 60 * 1000, max: 5, keyPrefix: 'auth-avatar' });

const VALID_CHARACTERISTIC_KEYS = ['bio', 'pronouns', 'astral_sign'];
const PRONOUN_VALUES = ['they/them', 'she/her', 'he/him', 'xe/xem', 'ze/zir', 'any', 'ask'];
const ASTRAL_SIGN_VALUES = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces', 'unknown'];

const router = Router();

async function safeList(
  pb: Awaited<ReturnType<typeof getAdminPb>>,
  collection: string,
  page: number,
  perPage: number,
  options: Record<string, unknown>,
): Promise<{ items: unknown[] }> {
  try {
    return await pb.collection(collection).getList(page, perPage, options);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // 404 = collection missing on a fresh PB instance; 400 = schema drift
    // / invalid pagination on an upgraded instance. Both should read as an
    // empty list rather than take down the whole endpoint.
    if (status === 404 || status === 400) {
      logger.warn(`collection "${collection}" unavailable on PB instance`, { collection, status });
      return { items: [] };
    }
    throw err;
  }
}

/**
 * Maps PB admin-read failures to a client-actionable status.
 * 401/403 = stale admin session -> force re-auth on next request (503).
 * 404 = collection/user missing -> 503 so the client treats it as
 * infrastructure, not a broken endpoint.
 * Any other error stays a real 500.
 */
export function pbErrorStatus(err: unknown): number {
  const status = (err as { status?: number })?.status;
  // 401/403 = stale admin session; 404 = collection missing on a fresh PB
  // instance; 400 = admin-auth rejection (wrong/rotated PB_ADMIN_*
  // credentials) or schema drift. All are retryable infrastructure states.
  // The SDK marks transport failures (PB unreachable) as status 0; >=500
  // = upstream failure. Only SDK errors carry a numeric status — a bare
  // Error (status undefined) is a programming bug and stays a real 500.
  if (status === 401 || status === 403 || status === 404 || status === 400 || status === 0 || (typeof status === 'number' && status >= 500)) {
    if (status === 401 || status === 403 || status === 400) {
      invalidateAdminPb();
    }
    return 503;
  }
  return 500;
}

function generateCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function avatarUrl(record: Record<string, unknown>): string {
  const filename = record.avatar as string;
  if (!filename) return '';
  if (/^https?:\/\//.test(filename)) return filename;
  return `${config.pbPublicUrl}/api/files/users/${record.id}/${filename}`;
}

function sanitizeUser(record: Record<string, unknown>, emailFallback = '') {
  const rawAvatar = avatarUrl(record);
  const version = (record.avatarVersion as number) || 0;
  return {
    id: record.id,
    email: record.email || emailFallback,
    username: record.username,
    accountType: record.accountType,
    isVerified: record.isVerified || false,
    isArchitect: record.isArchitect || false,
    tier: record.tier || 'free',
    // The version query param is the cross-platform cache-bust key:
    // every thay app hot-links the SAME canonical avatar URL and the
    // browser fetches a fresh copy the moment thaypley.com OR
    // auth.thaypley.com changes it (both write to this users record).
    avatar: rawAvatar ? `${rawAvatar}${rawAvatar.includes('?') ? '&' : '?'}v=${version}` : '',
    avatarVersion: version,
    birthday: record.birthday || '',
    created: record.created,
    updated: record.updated,
  };
}

// ── Session audit writes: fire-and-forget through a bounded queue ──
// Login/signup/refresh responses must NOT block on the sessions write
// (an extra PB round trip on the hot path). The queue bounds the
// in-memory backlog; overflow is dropped and counted, never blocking.

interface SessionRecord {
  userId: string;
  token: string;
  app: unknown;
  ip: string | undefined;
  userAgent: string;
  expiresAt: string;
}

async function writeSession(rec: SessionRecord): Promise<void> {
  const pb = await getAdminPb();
  await pb.collection('sessions').create({
    userId: rec.userId,
    tokenHash: hashToken(rec.token),
    app: normalizeApp(rec.app),
    ip: rec.ip,
    userAgent: rec.userAgent,
    expiresAt: rec.expiresAt,
    revoked: false,
  });
}

const sessionQueue = new BoundedQueue<SessionRecord>(writeSession, {
  concurrency: config.sessionQueueConcurrency,
  maxQueue: config.sessionQueueMax,
  onDrop: () => metrics.inc('thay_auth_session_queue_dropped_total'),
  onError: (err) => {
    metrics.inc('thay_auth_pb_errors_total', { op: 'recordSession' });
    logger.warn('recordSession failed (non-fatal)', { error: err });
  },
});

function enqueueSession(userId: string, token: string, app: unknown, req: Request): void {
  sessionQueue.push({
    userId,
    token,
    app,
    ip: req.ip,
    // PB's userAgent field has a max of 500 — truncate at the source so
    // the audit write can never fail collection validation.
    userAgent: ((req.headers['user-agent'] as string) || '').slice(0, 500),
    expiresAt: new Date(Date.now() + config.tokenExpiryMs).toISOString(),
  });
}

async function revokeSessionByToken(pb: Awaited<ReturnType<typeof getAdminPb>>, token: string): Promise<boolean> {
  try {
    // authRefresh can return a byte-identical token within the same second,
    // so multiple session rows may share one tokenHash. Revoke them all.
    const matches = await pb.collection('sessions').getList(1, 100, {
      filter: `tokenHash="${hashToken(token)}"`,
    });
    if (matches.items.length === 0) return false;
    await Promise.allSettled(
      matches.items.map((r) => pb.collection('sessions').update(r.id, { revoked: true })),
    );
    return true;
  } catch (err) {
    metrics.inc('thay_auth_pb_errors_total', { op: 'revokeSession' });
    logger.warn('revokeSessionByToken failed', { error: err });
    return false;
  }
}

// Classify a catalog row into desktop/cli/cloud/web by slug + download
// key-presence (not value-truthiness — legacy rows ship empty strings).
// Shared by the cache fill and the API fallback when the `kind` field is
// missing on a pre-migration row.
function classifyKind(rec: Record<string, unknown>): string {
  const slug = (rec.slug as string) || '';
  if (slug.includes('cli')) return 'cli';
  if (slug.includes('cloud')) return 'cloud';
  const dl = (rec.downloads as Record<string, string>) || {};
  return ('mac' in dl || 'windows' in dl || 'linux' in dl) ? 'desktop' : 'web';
}

// ── Public catalog cache (L1, stale-while-revalidate) ──────────────
// /auth/catalog is unauthenticated and identical for every caller — the
// single highest-value cache target. Stale-while-revalidate keeps p95
// flat during PB latency spikes; the CDN/edge layer should front this
// route as well (see scalability notes).

let catalogCache: { apps: unknown[]; fetchedAt: number } | null = null;
let catalogFetching: Promise<unknown[]> | null = null;

async function fetchCatalog(pb: Awaited<ReturnType<typeof getAdminPb>>): Promise<unknown[]> {
  const apps = await safeList(pb, 'catalog_apps', 1, 100, {
    filter: 'published=true',
    sort: 'sortOrder',
  });
  const mapped = apps.items.map((a: unknown) => {
    const rec = a as Record<string, unknown>;
    return {
      slug: rec.slug,
      displayName: rec.displayName,
      tagline: rec.tagline,
      description: rec.description,
      iconUrl: rec.iconUrl,
      isFree: rec.isFree,
      price: rec.price,
      version: rec.version,
      kind: classifyKind(rec),
      downloads: rec.downloads || {},
    };
  });
  // A curated fallback so the downloads page is never empty even when the
  // catalog_apps collection is missing/unseeded on a fresh PB instance.
  if (mapped.length === 0) {
    mapped.push(...FALLBACK_CATALOG);
  }
  catalogCache = { apps: mapped, fetchedAt: Date.now() };
  return mapped;
}

// ── Curated fleet catalog (fallback + UI source of truth) ──────────────
// The asked-for surface: thaypley(tunes), thaypley(tv), (jot),
// (chronometer), (dabba) desktop/cli/cloud, thaypley(studio). These entries
// are ALSO what the downloads page consumes when the PB collection has
// not been seeded yet.
interface CatalogEntry {
  slug: string;
  displayName: string;
  tagline: string;
  description: string;
  iconUrl: string;
  isFree: boolean;
  price: string;
  version: string;
  kind: string;
  downloads: Record<string, string>;
}

const FALLBACK_CATALOG: CatalogEntry[] = [
  {
    slug: 'thaypley-tunes',
    displayName: 'thaypley(tunes)',
    tagline: 'the whole world\'s music, curated for creators',
    description: 'stream, queue, and share across every device — deep artist mode, unlimited skips, and studio-grade output.',
    iconUrl: '',
    isFree: false,
    price: '$6/mo',
    version: '1.0.0',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thaypley-tv',
    displayName: 'thaypley(tv)',
    tagline: 'television for the multiverse',
    description: 'watch parties, ambient channels, and creator-first originals — the living room side of thaypley.',
    iconUrl: '',
    isFree: false,
    price: '$6/mo',
    version: '0.9.0',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thay-jot',
    displayName: '(jot)',
    tagline: 'thoughts, captured at light speed',
    description: 'the note surface of the thay universe — markdown, sync, and collaborative linking across every app.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '2.3.1',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'chronometer',
    displayName: '(chronometer)',
    tagline: 'time, but make it thay',
    description: 'the clock, timer, and world-time surface for the thay universe — built on the retro-LCD standard.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '1.4.0',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'dabba-desktop',
    displayName: '(dabba) — desktop',
    tagline: 'your local studio dock',
    description: 'unified desktop launcher for every thaypley service.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.6.2',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'dabba-cli',
    displayName: '(dabba) — cli',
    tagline: 'the whole fleet in your terminal',
    description: 'auth, deploy, and orchestrate from anywhere.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.6.2',
    kind: 'cli',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'dabba-cloud',
    displayName: '(dabba) — cloud',
    tagline: 'your services, running everywhere',
    description: 'managed cloud for the thay universe.',
    iconUrl: '',
    isFree: false,
    price: '$3/mo',
    version: '0.6.2',
    kind: 'cloud',
    downloads: { web: '' },
  },
  {
    slug: 'thaypley-studio',
    displayName: 'thaypley(studio)',
    tagline: 'create the whole universe',
    description: 'the creator engine — music, video, design, and publishing in one studio-grade surface.',
    iconUrl: '',
    isFree: false,
    price: '$12/mo',
    version: '1.0.0',
    kind: 'desktop',
    downloads: { mac: '', windows: '', linux: '' },
  },
];

async function getCatalogApps(pb: Awaited<ReturnType<typeof getAdminPb>>): Promise<unknown[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.fetchedAt < config.catalogCacheTtlMs) {
    metrics.inc('thay_auth_cache_hits_total', { cache: 'catalog' });
    return catalogCache.apps;
  }
  if (catalogCache) {
    // Stale: serve immediately, refresh in background (single-flight).
    metrics.inc('thay_auth_cache_hits_total', { cache: 'catalog-stale' });
    if (!catalogFetching) {
      catalogFetching = fetchCatalog(pb).finally(() => {
        catalogFetching = null;
      });
    }
    return catalogCache.apps;
  }
  metrics.inc('thay_auth_cache_misses_total', { cache: 'catalog' });
  if (!catalogFetching) {
    catalogFetching = fetchCatalog(pb).finally(() => {
      catalogFetching = null;
    });
  }
  return catalogFetching;
}

// ── Per-user caches (30s) with explicit invalidation ───────────────
// Split caches: /me only needs the user record; /profile additionally
// needs characteristics. Sharing one entry forced /me to fetch rows it
// never reads — the two caches make each endpoint pay only for its own
// data. Every user-mutating route below calls invalidateUserCache(id).

const userCache = new LRUCache<string, Record<string, unknown>>({
  max: config.profileCacheMax,
  ttl: config.profileCacheTtlMs,
});

const charsCache = new LRUCache<string, Record<string, string>>({
  max: config.profileCacheMax,
  ttl: config.profileCacheTtlMs,
});

function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
  charsCache.delete(userId);
}

async function getUserData(
  pb: Awaited<ReturnType<typeof getAdminPb>>,
  userId: string,
): Promise<Record<string, unknown>> {
  const cached = userCache.get(userId);
  if (cached) {
    metrics.inc('thay_auth_cache_hits_total', { cache: 'user' });
    return cached;
  }
  metrics.inc('thay_auth_cache_misses_total', { cache: 'user' });
  const user = await pb.collection('users').getOne(userId);
  const record = user as unknown as Record<string, unknown>;
  userCache.set(userId, record);
  return record;
}

async function getCharsData(
  pb: Awaited<ReturnType<typeof getAdminPb>>,
  userId: string,
): Promise<Record<string, string>> {
  const cached = charsCache.get(userId);
  if (cached) {
    metrics.inc('thay_auth_cache_hits_total', { cache: 'chars' });
    return cached;
  }
  metrics.inc('thay_auth_cache_misses_total', { cache: 'chars' });
  const charsList = await safeList(pb, 'user_characteristics', 1, 200, {
    filter: `userId="${escapePbFilterValue(userId)}"`,
  });
  const chars: Record<string, string> = {};
  for (const c of charsList.items) {
    const rec = c as unknown as Record<string, string>;
    chars[rec.key] = rec.value;
  }
  charsCache.set(userId, chars);
  return chars;
}

// ─── Invite ────────────────────────────────────────────────────────

router.post('/check-invite', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const { code } = req.body || req.query;
    const err = validateInviteCode(code);
    if (err) return res.status(200).json({ valid: false, error: err });

    const pb = await getAdminPb();
    const escapedCode = escapePbFilterValue(code.toString().trim().toUpperCase());
    const invites = await pb.collection('signup_invites').getList(1, 1, {
      filter: `code="${escapedCode}"`,
    });

    if (invites.items.length === 0) {
      return res.status(200).json({ valid: false, error: 'Invalid invite code' });
    }

    const invite = invites.items[0] as unknown as Record<string, unknown>;
    const maxUses = (invite.maxUses as number) || 1;
    const useCount = (invite.useCount as number) || 0;
    const expiresAt = invite.expiresAt ? new Date(invite.expiresAt as string) : null;

    if (expiresAt && expiresAt < new Date()) {
      return res.status(200).json({ valid: false, error: 'Invite code has expired' });
    }
    if (useCount >= maxUses) {
      return res.status(200).json({ valid: false, error: 'Invite code has been fully used' });
    }

    return res.status(200).json({ valid: true });
  } catch (err) {
    logger.error('check-invite error:', err);
    return res.status(500).json({ valid: false, error: 'Internal error' });
  }
});

// ─── Waitlist ──────────────────────────────────────────────────────

router.post('/waitlist', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const { email, note, source } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const pb = await getAdminPb();
    const record = await pb.collection('signup_waitlist').create({
      email: email.toLowerCase().trim(),
      note: note || '',
      source: source || 'homebase',
    });

    return res.status(201).json({ success: true, id: record.id, message: 'You have been added to the waitlist.' });
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to join waitlist';
    if (msg.includes('unique') || msg.includes('already')) {
      return res.status(200).json({ success: true, message: 'This email is already on the waitlist.' });
    }
    logger.error('waitlist error:', err);
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// ─── Signup ────────────────────────────────────────────────────────

router.post('/signup', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const { email, password, username, accountType, birthday, inviteCode, app } = req.body;

    const errors: string[] = [];
    const e1 = validateEmail(email);
    const e2 = validatePassword(password);
    const e3 = validateUsername(username);
    const e4 = validateAccountType(accountType);
    const e5 = validateBirthday(birthday);
    const e6 = validateInviteCode(inviteCode);
    if (e1) errors.push(e1);
    if (e2) errors.push(e2);
    if (e3) errors.push(e3);
    if (e4) errors.push(e4);
    if (e5) errors.push(e5);
    if (e6) errors.push(e6);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const pb = await getAdminPb();
    const code = inviteCode.toString().trim().toUpperCase();
    const escapedCode = escapePbFilterValue(code);
    const invites = await pb.collection('signup_invites').getList(1, 1, {
      filter: `code="${escapedCode}"`,
    });
    if (invites.items.length === 0) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    const invite = invites.items[0] as unknown as Record<string, unknown>;
    const inviteId = invite.id as string;
    const maxUses = (invite.maxUses as number) || 1;
    const useCount = (invite.useCount as number) || 0;
    if (useCount >= maxUses) {
      return res.status(400).json({ error: 'Invite code has been fully used' });
    }

    const sanitizedUsername = sanitizeUsername(username);
    const normalizedEmail = email.toLowerCase().trim();
    const birthDate = new Date(birthday);
    let age = new Date().getFullYear() - birthDate.getFullYear();
    const monthDiff = new Date().getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && new Date().getDate() < birthDate.getDate())) age--;

    let userId: string;
    let redeemSucceeded = false;
    if (config.directSqlUsers) {
      // Pre-check duplicates before spending a bcrypt round (~78ms). The
      // unique indexes are the real enforcement; createUserDirect maps a
      // lost race to a DuplicateFieldError below.
      const dupes = await userExistsDirect(config.pbDataPath, normalizedEmail, sanitizedUsername);
      if (dupes.email) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
      if (dupes.username) {
        return res.status(400).json({ error: 'An account with this username already exists' });
      }

      const created = await createUserDirect(config.pbDataPath, {
        email: normalizedEmail,
        password,
        username: sanitizedUsername,
        accountType,
        birthday,
        age,
        isVerified: false,
        tier: 'free',
      });
      userId = created.id;

      // Atomic compare-and-swap on useCount — two concurrent signups with
      // the same code can't both pass. If we lost the race, undo the user.
      redeemSucceeded = await redeemInviteDirect(config.pbDataPath, inviteId, maxUses, userId);
      if (!redeemSucceeded) {
        try { await pb.collection('users').delete(userId); } catch { /* best effort */ }
        return res.status(400).json({ error: 'Invite code has been fully used' });
      }
    } else {
      const created = await pb.collection('users').create({
        email: normalizedEmail,
        password,
        passwordConfirm: password,
        username: sanitizedUsername,
        accountType,
        birthday: birthday,
        age,
        isVerified: false,
        tier: 'free',
      });
      userId = (created as unknown as Record<string, string>).id;

      try {
        await pb.collection('signup_invites').update(inviteId, {
          useCount: useCount + 1,
          used: useCount + 1 >= maxUses,
          usedBy: userId,
          usedAt: new Date().toISOString(),
        });
        redeemSucceeded = true;
      } catch (_redeemErr) {
        logger.warn('Failed to redeem invite:', _redeemErr);
      }
    }

    const userPb = createClient();
    const authData = await userPb.collection('users').authWithPassword(normalizedEmail, password);
    enqueueSession(userId, authData.token, app, req);

    logger.debug(`User signed up: ${userId} (${sanitizedUsername})${config.directSqlUsers ? ' [direct-sql]' : ''}`);

    return res.status(201).json({
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
      token: authData.token,
      sessionToken: signUserToken(userId, normalizeApp(app), authData.token),
    });
  } catch (err: unknown) {
    if (err instanceof DuplicateFieldError) {
      // Lost a UNIQUE race between the pre-check and the INSERT.
      return res.status(400).json({
        error: err.field === 'email'
          ? 'An account with this email already exists'
          : 'An account with this username already exists',
      });
    }
    logger.error('signup error:', err);
    // Fail generically — never leak whether an email/username is taken via
    // PB's raw error (that's the enumeration fix).
    return res.status(400).json({ error: 'Signup failed' });
  }
});

// ─── Login ─────────────────────────────────────────────────────────

router.post('/login', loginLimit, async (req: Request, res: Response) => {
  try {
    const { identity, password, app } = req.body;
    if (!identity || !password) {
      return res.status(400).json({ error: 'identity and password are required' });
    }

    let loginIdentity = identity.toLowerCase().trim();
    if (!loginIdentity.includes('@') && /^[a-z0-9_]{3,20}$/.test(loginIdentity)) {
      try {
        const adminPb = await getAdminPb();
        const escapedIdentity = escapePbFilterValue(loginIdentity);
        const match = await adminPb.collection('users').getList(1, 1, {
          filter: `username="${escapedIdentity}"`,
        });
        if (match.items.length > 0) {
          const found = match.items[0] as unknown as Record<string, string>;
          // PocketBase hides `email` from admin reads when the record's
          // emailVisibility is off, so found.email can be undefined. Keep the
          // raw username as the fallback — PB's authWithPassword resolves
          // usernames natively.
          loginIdentity = found.email || loginIdentity;
        }
      } catch { /* fall through to username identity */ }
    }
    if (!loginIdentity) {
      loginIdentity = identity.toLowerCase().trim();
    }

    const pb = createClient();
    const authData = await pb.collection('users').authWithPassword(loginIdentity, password);
    const userId = authData.record.id as string;
    enqueueSession(userId, authData.token, app, req);

    const record = authData.record as unknown as Record<string, unknown>;
    if (!record.isVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        token: authData.token,
        sessionToken: signUserToken(userId, normalizeApp(app), authData.token),
        user: sanitizeUser(record),
      });
    }

    logger.debug(`User logged in: ${userId} (${record.username})`);

    return res.status(200).json({
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
      token: authData.token,
      sessionToken: signUserToken(userId, normalizeApp(app), authData.token),
      expiry: Date.now() + config.tokenExpiryMs,
    });
  } catch (err) {
    metrics.inc('thay_auth_login_failures_total');
    logger.debug('login failed:', err);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ─── Session Management ────────────────────────────────────────────

router.post('/logout', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const revoked = await revokeSessionByToken(pb, req.pbToken!);

    // Fast-path: make the next request with this token 401 immediately,
    // without waiting for the 60s revocation-cache TTL.
    markSessionRevoked(req.pbToken!);

    if (revoked) {
      logger.debug(`Session revoked on logout for user ${req.user!.id}`);
    } else {
      logger.debug(`Logout: no session found to revoke for user ${req.user!.id}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Logout failed:', err);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    // /me only needs the user record — never pays for characteristics.
    const user = await getUserData(pb, req.user!.id);
    return res.status(200).json(sanitizeUser(user, req.user?.email || ''));
  } catch (err) {
    logger.error('/me error:', err);
    const status = pbErrorStatus(err);
    return res.status(status).json({
      error: 'Failed to fetch user',
      ...(status === 503 ? { code: 'PROFILE_UNAVAILABLE', retryAfter: 5 } : {}),
    });
  }
});

router.post('/refresh', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = createClient();
    pb.authStore.save(req.pbToken!, null);
    const authData = await pb.collection('users').authRefresh();
    const userId = authData.record.id as string;
    enqueueSession(userId, authData.token, req.body?.app, req);
    return res.status(200).json({
      token: authData.token,
      sessionToken: signUserToken(userId, normalizeApp(req.body?.app), authData.token),
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
    });
  } catch {
    return res.status(401).json({ error: 'Token refresh failed' });
  }
});

// ─── Email Verification ────────────────────────────────────────────

router.post('/send-verification', strictAuthLimit, requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const user = req.user!;
    const code = generateCode();
    const expiry = new Date(Date.now() + config.verificationCodeExpiryMs).toISOString();

    await pb.collection('users').update(user.id, {
      emailVerificationCode: code,
      emailVerificationCodeExpiry: expiry,
    });

    const { sendEmail, verificationEmailTemplate } = await import('../utils/email.js');
    await sendEmail(user.email, 'Verify your email', verificationEmailTemplate(code));

    return res.status(200).json({ success: true, message: 'Verification code sent' });
  } catch (_err) {
    logger.error('send-verification error:', _err);
    return res.status(500).json({ error: 'Failed to send verification' });
  }
});

router.post('/verify-email', strictAuthLimit, requireUser, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'Verification code required' });

    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);

    const storedCode = (user as unknown as Record<string, unknown>).emailVerificationCode as string;
    const expiry = (user as unknown as Record<string, unknown>).emailVerificationCodeExpiry as string;

    // Timing-safe compare (constant-time against a 6-digit code): hash both
    // sides to equal-length buffers so a length difference can't leak either.
    const input = crypto.createHash('sha256').update(code.trim()).digest();
    const stored = crypto.createHash('sha256').update(storedCode || '').digest();
    const codesMatch = storedCode !== '' && crypto.timingSafeEqual(input, stored);

    if (!codesMatch) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    if (expiry && new Date(expiry) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    await pb.collection('users').update(req.user!.id, {
      isVerified: true,
      emailVerified: true,
      emailVerificationCode: '',
      emailVerificationCodeExpiry: '',
    });
    invalidateUserCache(req.user!.id);

    return res.status(200).json({ success: true, message: 'Email verified' });
  } catch (err) {
    logger.error('verify-email error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── Username Change ───────────────────────────────────────────────

const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

router.post('/change-username', requireUser, async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });

    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);
    const lastChange = (user as unknown as Record<string, unknown>).lastUsernameChangeAt as string;

    if (lastChange) {
      const elapsed = Date.now() - new Date(lastChange).getTime();
      if (elapsed < USERNAME_COOLDOWN_MS) {
        const daysLeft = Math.ceil((USERNAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
        return res.status(429).json({ error: `Username can be changed again in ${daysLeft} day(s)` });
      }
    }

    const sanitizedUsername = sanitizeUsername(username);
    const updated = await pb.collection('users').update(req.user!.id, {
      username: sanitizedUsername,
      lastUsernameChangeAt: new Date().toISOString(),
    });
    invalidateUserCache(req.user!.id);

    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err: unknown) {
    logger.error('change-username error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to change username';
    return res.status(400).json({ error: msg });
  }
});

// ─── Avatar Upload ─────────────────────────────────────────────────

const AVATAR_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

router.post('/avatar', avatarLimit, requireUser, async (req: Request, res: Response) => {
  try {
    const { data, contentType } = req.body || {};
    if (typeof data !== 'string' || !data) {
      return res.status(400).json({ error: 'data (base64 image) is required' });
    }
    const ext = AVATAR_MIME_TYPES[contentType];
    if (!ext) {
      return res.status(400).json({ error: `contentType must be one of: ${Object.keys(AVATAR_MIME_TYPES).join(', ')}` });
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 data' });
    }
    if (bytes.length === 0) return res.status(400).json({ error: 'Empty image' });
    if (bytes.length > AVATAR_MAX_BYTES) {
      return res.status(400).json({ error: 'Avatar must be 4MB or smaller' });
    }

    const pb = await getAdminPb();
    const current = await pb.collection('users').getOne(req.user!.id);
    const nextVersion = Number((current as unknown as Record<string, unknown>).avatarVersion || 0) + 1;

    // One multipart update: new file + avatarVersion atomically. The
    // version number is the cross-app cache-bust — every thay product
    // renders the canonical URL with ?v=N so this single write
    // propagates the new avatar to thaypley.com, tunes, jot, dabba,
    // and every other thay-auth-connected app on their next profile
    // fetch (the URL changes → fresh image, no forced re-auth).
    const form = new FormData();
    form.append('avatar', new Blob([new Uint8Array(bytes)], { type: contentType }), `avatar.${ext}`);
    form.append('avatarVersion', String(nextVersion));
    const updated = await pb.collection('users').update(req.user!.id, form);
    invalidateUserCache(req.user!.id);
    void notifyAvatarSync(req.user!.id, nextVersion);

    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err: unknown) {
    logger.error('avatar upload error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to upload avatar';
    return res.status(400).json({ error: msg });
  }
});

router.delete('/avatar', avatarLimit, requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const current = await pb.collection('users').getOne(req.user!.id);
    const nextVersion = Number((current as unknown as Record<string, unknown>).avatarVersion || 0) + 1;
    const updated = await pb.collection('users').update(req.user!.id, {
      avatar: null,
      avatarVersion: nextVersion,
    });
    invalidateUserCache(req.user!.id);
    void notifyAvatarSync(req.user!.id, nextVersion);
    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    logger.error('avatar delete error:', err);
    return res.status(400).json({ error: 'Failed to remove avatar' });
  }
});

// ─── Check Username Availability ────────────────────────────────────

router.get('/check-username', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const username = req.query.username as string;
    if (!username) return res.status(400).json({ error: 'username query param required' });
    const err = validateUsername(username);
    if (err) return res.status(200).json({ available: false, error: err });

    const pb = await getAdminPb();
    const escapedUsername = escapePbFilterValue(sanitizeUsername(username));
    const result = await pb.collection('users').getList(1, 1, {
      filter: `username="${escapedUsername}"`,
    });
    return res.status(200).json({ available: result.items.length === 0 });
  } catch (err) {
    logger.error('check-username error:', err);
    return res.status(500).json({ error: 'Failed to check username' });
  }
});

// ─── Password Reset ────────────────────────────────────────────────

router.post('/request-password-reset', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const pb = createClient();
    await pb.collection('users').requestPasswordReset(email.toLowerCase().trim());

    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  } catch {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  }
});

router.post('/confirm-password-reset', strictAuthLimit, async (req: Request, res: Response) => {
  try {
    const { token, password, passwordConfirm } = req.body;
    if (!token || !password || !passwordConfirm) {
      return res.status(400).json({ error: 'token, password, and passwordConfirm are required' });
    }
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const pb = createClient();
    await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm);

    return res.status(200).json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    logger.debug('confirm-password-reset error:', err);
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }
});

// ─── Profile (full user + characteristics) ──────────────────────────

router.get('/profile', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const [user, chars] = await Promise.all([getUserData(pb, userId), getCharsData(pb, userId)]);
    return res.status(200).json({
      ...sanitizeUser(user),
      characteristics: chars,
    });
  } catch (err) {
    logger.error('/profile GET error:', err);
    const status = pbErrorStatus(err);
    return res.status(status).json({
      error: 'Failed to fetch profile',
      ...(status === 503 ? { code: 'PROFILE_UNAVAILABLE', retryAfter: 5 } : {}),
    });
  }
});

router.patch('/profile', requireUser, async (req: Request, res: Response) => {
  try {
    const { characteristics } = req.body;
    const pb = await getAdminPb();
    const userId = req.user!.id;

    if (characteristics && typeof characteristics === 'object') {
      // Validate EVERYTHING first (same semantics as before — a bad value
      // must 400 before any write), collecting the ops.
      const ops: Array<{ key: string; value: string; updateId?: string }> = [];
      for (const [key, value] of Object.entries(characteristics)) {
        if (!VALID_CHARACTERISTIC_KEYS.includes(key)) continue;
        const strVal = String(value).trim();

        if (key === 'pronouns' && strVal && !PRONOUN_VALUES.includes(strVal)) {
          return res.status(400).json({ error: `Invalid pronoun value. Valid: ${PRONOUN_VALUES.join(', ')}` });
        }
        if (key === 'astral_sign' && strVal && !ASTRAL_SIGN_VALUES.includes(strVal.toLowerCase())) {
          return res.status(400).json({ error: `Invalid astral sign. Valid: ${ASTRAL_SIGN_VALUES.join(', ')}` });
        }
        if (key === 'bio' && strVal.length > 280) {
          return res.status(400).json({ error: 'Bio must be 280 characters or fewer' });
        }
        ops.push({ key, value: strVal });
      }

      if (ops.length > 0) {
        // ONE read instead of N (the old code did a getList per key).
        const existing = await pb.collection('user_characteristics').getList(1, 50, {
          filter: `userId="${escapePbFilterValue(userId)}"`,
        });
        const byKey = new Map<string, string>();
        for (const c of existing.items) {
          const rec = c as unknown as Record<string, string>;
          byKey.set(rec.key, rec.id as string);
        }

        await Promise.allSettled(
          ops.map((op) => {
            const updateId = byKey.get(op.key);
            if (updateId) {
              return pb.collection('user_characteristics').update(updateId, { value: op.value });
            }
            return pb.collection('user_characteristics').create({
              userId,
              key: op.key,
              value: op.value,
              visibility: 'public',
            });
          }),
        );
      }
    }

    invalidateUserCache(userId);
    const [user, chars] = await Promise.all([getUserData(pb, userId), getCharsData(pb, userId)]);
    return res.status(200).json({
      ...sanitizeUser(user),
      characteristics: chars,
    });
  } catch (err) {
    logger.error('/profile PATCH error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to update profile';
    return res.status(400).json({ error: msg });
  }
});

// ─── Characteristics CRUD ──────────────────────────────────────────

router.get('/profile/characteristics', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const chars = await getCharsData(pb, req.user!.id);
    return res.status(200).json({ characteristics: chars });
  } catch (err) {
    logger.error('/profile/characteristics GET error:', err);
    const status = pbErrorStatus(err);
    return res.status(status).json({
      error: 'Failed to fetch characteristics',
      ...(status === 503 ? { code: 'PROFILE_UNAVAILABLE', retryAfter: 5 } : {}),
    });
  }
});

router.put('/profile/characteristics', requireUser, async (req: Request, res: Response) => {
  try {
    const { characteristics } = req.body;
    if (!characteristics || typeof characteristics !== 'object') {
      return res.status(400).json({ error: 'characteristics object required' });
    }

    const pb = await getAdminPb();
    const userId = req.user!.id;

    // Collect deletion ops, then creation ops — validated first.
    const existing = await pb.collection('user_characteristics').getList(1, 200, {
      filter: `userId="${escapePbFilterValue(userId)}"`,
    });
    const deleteOps = existing.items.map((c) => pb.collection('user_characteristics').delete(c.id));
    await Promise.allSettled(deleteOps);

    const creates: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(characteristics)) {
      if (!VALID_CHARACTERISTIC_KEYS.includes(key)) continue;
      const strVal = String(value).trim();
      if (!strVal) continue;

      if (key === 'pronouns' && !PRONOUN_VALUES.includes(strVal)) continue;
      if (key === 'astral_sign' && !ASTRAL_SIGN_VALUES.includes(strVal.toLowerCase())) continue;
      if (key === 'bio' && strVal.length > 280) continue;

      creates.push({ key, value: strVal });
    }

    const createOps = creates.map((entry) => pb.collection('user_characteristics').create({
      userId,
      key: entry.key,
      value: entry.value,
      visibility: 'public',
    }));
    await Promise.allSettled(createOps);
    invalidateUserCache(userId);

    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(characteristics)) {
      if (VALID_CHARACTERISTIC_KEYS.includes(key)) {
        map[key] = String(value).trim();
      }
    }

    return res.status(200).json({ characteristics: map });
  } catch (err) {
    logger.error('/profile/characteristics PUT error:', err);
    return res.status(500).json({ error: 'Failed to update characteristics' });
  }
});

// ─── Public App Catalog ─────────────────────────────────────────────

router.get('/catalog', async (_req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const apps = await getCatalogApps(pb);
    return res.status(200).json({ apps });
  } catch (err) {
    logger.error('/catalog GET error:', err);
    const status = pbErrorStatus(err);
    return res.status(status).json({
      error: 'Failed to fetch catalog',
      ...(status === 503 ? { code: 'CATALOG_UNAVAILABLE', retryAfter: 5 } : {}),
    });
  }
});

// ─── Subscriptions & Billing (thay-sub) ─────────────────────────────
// Exposes the future thay-subscription surface: the account's current
// thay-sub tier (from the users.tier field), plus the per-app purchase
// status derived from the public catalog. Real payment-provider wiring
// (Stripe/Paddle checkout, webhooks, entitlements) lands behind this
// contract, so clients never need to change.

const SUBSCRIPTION_TIERS = ['free', 'core', 'plus', 'pro', 'enterprise'] as const;
type SubscriptionTier = typeof SUBSCRIPTION_TIERS[number];

export const SUBSCRIPTION_PLANS: Array<{
  id: SubscriptionTier;
  name: string;
  monthly: number;
  blurb: string;
  features: string[];
}> = [
  {
    id: 'free',
    name: 'thay free',
    monthly: 0,
    blurb: 'every core surface, one identity',
    features: ['thaypley(portal) access', '1 device', 'community support'],
  },
  {
    id: 'core',
    name: 'thay core',
    monthly: 6,
    blurb: 'the everyday creator tier',
    features: ['everything in free', 'all streaming apps', '5 devices', 'priority support'],
  },
  {
    id: 'plus',
    name: 'thay plus',
    monthly: 12,
    blurb: 'for serious makers',
    features: ['everything in core', 'thaypley(studio)', '10 devices', 'sync across all surfaces'],
  },
  {
    id: 'pro',
    name: 'thay pro',
    monthly: 24,
    blurb: 'the full creator stack',
    features: ['everything in plus', 'unlimited devices', 'early features', 'direct line to the studio'],
  },
  {
    id: 'enterprise',
    name: 'thay enterprise',
    monthly: -1,
    blurb: 'custom fleet & governance',
    features: ['everything in pro', 'SSO/SAML', 'dedicated support'],
  },
];

router.get('/subscription', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);

    const rawTier = (user.tier as string) || 'free';
    const tier = SUBSCRIPTION_TIERS.includes(rawTier as SubscriptionTier) ? rawTier as SubscriptionTier : 'free';
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === tier) || SUBSCRIPTION_PLANS[0];

    // App purchases from the public catalog + the user's entitlement map.
    // A user's `app_entitlements` field is a JSON string map:
    //   { [slug]: 'owned' | 'subscribed' | 'trial' }
    const catalog = await getCatalogApps(pb);
    let entitlements: Record<string, string> = {};
    try {
      entitlements = (user.app_entitlements && JSON.parse(user.app_entitlements as string)) || {};
    } catch {
      /* malformed entitlements — treat as empty */
    }
    const purchases = catalog
      .filter((a: unknown) => (a as { isFree?: boolean }).isFree === false)
      .map((a: unknown) => {
        const rec = a as { slug: string; displayName: string; price: string };
        return {
          slug: rec.slug,
          appName: rec.displayName,
          price: (rec.price === '0' || rec.price === '') ? 'one-time' : (rec.price || 'one-time'),
          owned: entitlements[rec.slug] === 'owned' || entitlements[rec.slug] === 'subscribed',
          status: entitlements[rec.slug] || 'none',
        };
      });

    // Portal is driven by POST /auth/subscription/portal (creates a live
    // Stripe billing-portal session when configured) — never a stale GET link.
    const manageUrl = '';

    return res.status(200).json({
      tier,
      plan: {
        id: plan.id,
        name: plan.name,
        monthly: plan.monthly,
        blurb: plan.blurb,
        features: plan.features,
      },
      purchases,
      // Real checkout/portal URLs now: created lazily by the UI via
      // POST /auth/subscription/checkout + /portal (no keys = mock mode).
      checkoutUrl: '',
      manageUrl,
      billingEnabled: billingConfigured(),
    });
  } catch (err) {
    logger.error('/subscription GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

router.post('/subscription/checkout', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);
    const targetTier = String((req.body as { tier?: string })?.tier || '').toLowerCase();
    if (!SUBSCRIPTION_TIERS.includes(targetTier as SubscriptionTier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    if (targetTier === 'free') {
      return res.status(400).json({ error: 'Free tier has no checkout' });
    }
    const email = (user.email as string) || '';
    const result = await createCheckoutSession({
      userId,
      email,
      tier: targetTier,
      successUrl: `${config.appBaseUrl}/#/billing?checkout=success&tier=${targetTier}`,
      cancelUrl: `${config.appBaseUrl}/#/billing?checkout=cancelled`,
    });
    // Remember the pending upgrade so the webhook can reconcile it even
    // if the client navigates away mid-checkout.
    await pb.collection('users').update(userId, {
      pending_tier: targetTier,
      pending_session: result.sessionId,
    }).catch(() => undefined);
    invalidateUserCache(userId);
    return res.status(200).json({ url: result.url, mode: result.mode, sessionId: result.sessionId });
  } catch (err) {
    logger.error('/subscription/checkout POST error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/subscription/portal', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);
    const customerId = (user.stripe_customer_id as string) || '';
    if (!customerId) {
      return res.status(404).json({ error: 'No billing customer yet' });
    }
    const result = await createPortalSession({
      customerId,
      returnUrl: `${config.appBaseUrl}/#/billing`,
    });
    return res.status(200).json({ url: result.url, mode: result.mode });
  } catch (err) {
    logger.error('/subscription/portal POST error:', err);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

router.post('/subscription/cancel', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);
    const stripeSubId = (user.stripe_subscription_id as string) || '';
    if (user.tier === 'free' && !stripeSubId) {
      return res.status(400).json({ error: 'No subscription to cancel' });
    }
    if (stripeSubId) {
      await cancelSubscription(stripeSubId);
    }
    // Local downgrade: free immediately, entitlements cleared.
    await pb.collection('users').update(userId, {
      tier: 'free',
      stripe_subscription_id: '',
      app_entitlements: '{}',
    }).catch(() => undefined);
    invalidateUserCache(userId);
    return res.status(200).json({ ok: true, tier: 'free' });
  } catch (err) {
    logger.error('/subscription/cancel POST error:', err);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Stripe webhook — raw body (mounted before express.json in index.ts).
// Reconciles checkout completion / subscription lifecycle / entitlement
// grants without the client in the loop.
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // express.raw() mounted on /auth/webhook puts the exact bytes in req.body.
    const raw = Buffer.isBuffer((req as unknown as { body?: unknown }).body) ? (req.body as Buffer) : Buffer.from('');
    if (!raw.length) return res.status(400).json({ error: 'Empty webhook body' });
    const signature = String(req.headers['stripe-signature'] || '');
    const events = await verifyWebhook(raw, signature);
    for (const ev of events as Array<{ type?: string; data?: { object?: Record<string, unknown> } }>) {
      const type = String(ev.type || '');
      const data = (ev.data?.object || {}) as Record<string, any>;
      const userId = String(data.client_reference_id || '')
        || String(data.metadata?.userId || '')
        || String(data.customer_metadata?.userId || '');
      if (!userId) continue;
      const pb = await getAdminPb();
      let user: Record<string, unknown>;
      try {
        user = await getUserData(pb, userId);
      } catch {
        logger.warn('Webhook referenced unknown user', { userId });
        continue;
      }
      if (type === 'checkout.session.completed' || type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
        const tier = String(data.metadata?.tier || user.pending_tier || 'pro');
        const subId = String(data.subscription || data.id || user.stripe_subscription_id || '');
        const customerId = String(data.customer || user.stripe_customer_id || '');
        const finalTier = SUBSCRIPTION_TIERS.includes(tier as SubscriptionTier) ? tier as SubscriptionTier : 'pro';
        await pb.collection('users').update(userId, {
          tier: finalTier,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          pending_tier: '',
          pending_session: '',
        }).catch(() => undefined);
        invalidateUserCache(userId);
        logger.info('Webhook granted tier', { userId, tier: finalTier });
      } else if (type === 'checkout.session.expired') {
        await pb.collection('users').update(userId, { pending_tier: '', pending_session: '' }).catch(() => undefined);
        invalidateUserCache(userId);
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('/webhook POST error:', err);
    return res.status(400).json({ error: 'Webhook signature invalid or event malformed' });
  }
});

// ─── Platform Relay (account switcher) ─────────────────────────────
// The right-panel (pley/fam/werk) switcher posts the current thay-auth
// session token here BEFORE navigating to the target subdomain. Best
// effort: if the token is valid we set a shared cookie for the relay
// partner, and the client navigates regardless — the other subdomain
// re-authenticates with its own thay-auth client if the cookie is absent.
router.post('/relay', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing token' });
  }
  try {
    const wrapped = verifyWrappedUserToken(token);
    if (!wrapped || !wrapped.pbToken) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    // Hand the inner PB token to whichever thaypley subdomain the account
    // switcher is about to navigate to. Short-lived + SameSite=Lax: the
    // destination app's thay-auth client can read this to warm the session;
    // it expires in minutes, so it's never a standing credential.
    const pbToken = wrapped.pbToken;
    res.setHeader(
      'Set-Cookie',
      `thay_auth_relay=${pbToken}; Path=/; Domain=.thaypley.com; SameSite=Lax; Secure; Max-Age=900`,
    );
    return res.status(200).json({ ok: true, user: { id: wrapped.sub } });
  } catch (err) {
    logger.error('/relay error:', err);
    return res.status(503).json({ ok: false, error: 'Relay temporarily unavailable' });
  }
});

// ─── Relay consumption (thaypley.com / fam / werk side) ────────────
// The destination subdomain calls this with the `thay_auth_relay` cookie
// (set by /relay just before the account switcher navigates). thay-auth
// verifies the inner PB token, mints a FRESH wrapped thay-auth token for
// the requesting app, and clears the cookie. The app then stores the new
// session token as if the platform had logged in itself.
//
// The cookie is on Domain=.thaypley.com so every sibling subdomain can
// consume it; SameSite=Lax keeps it to top-level navigations only.
router.post('/consume-relay', async (req: Request, res: Response) => {
  const relay = String((req.headers.cookie || '').match(/(?:^|;\s*)thay_auth_relay=([^;]+)/)?.[1] || '');
  if (!relay) {
    return res.status(404).json({ ok: false, error: 'No relay cookie' });
  }
  try {
    const verified = await verifyPbUserToken(relay);
    if (!verified) {
      // Stripe-documented cookie-delete: must reproduce the Secure flag of
      // the cookie it clears, or browsers drop the deletion.
      res.setHeader('Set-Cookie', 'thay_auth_relay=; Path=/; Domain=.thaypley.com; Max-Age=0; Secure');
      return res.status(401).json({ ok: false, error: 'Relay token invalid or expired' });
    }

    // Which app is consuming? The requesting subdomain or an explicit aud
    // in the body. normalizeApp defaults unknown values to 'homebase'.
    const requestedAud = String((req.body as { aud?: unknown })?.aud || '');
    const aud = normalizeApp(requestedAud);

    const fresh = signUserToken(verified.user.id, aud, relay);

    // Clear the one-time relay cookie (Secure echoed back; see above).
    res.setHeader('Set-Cookie', 'thay_auth_relay=; Path=/; Domain=.thaypley.com; Max-Age=0; Secure');
    return res.status(200).json({
      ok: true,
      app: aud,
      // pbToken: the raw PB session for legacy siblings whose own backend
      // verifies against PocketBase directly (thaypley.com stores this as
      // its tp_token).
      pbToken: relay,
      user: {
        id: verified.user.id,
        username: verified.user.username,
        email: verified.user.email,
        accountType: verified.user.accountType,
        isArchitect: verified.user.isArchitect,
        tier: verified.user.tier,
        avatar: verified.user.avatar,
      },
      token: fresh,
      expiresIn: Math.floor(config.tokenExpiryMs / 1000),
    });
  } catch (err) {
    logger.error('/consume-relay error:', err);
    return res.status(503).json({ ok: false, error: 'Relay consumption temporarily unavailable' });
  }
});

// ─── Apps Management ───────────────────────────────────────────────

router.get('/apps', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const apps = await safeList(pb, 'user_apps', 1, 100, {
      filter: `userId="${escapePbFilterValue(req.user!.id)}"`,
      sort: '-installedAt',
    });
    return res.status(200).json({
      apps: apps.items.map((a: unknown) => {
        const rec = a as Record<string, unknown>;
        return {
          id: rec.id,
          appId: rec.appId,
          appName: rec.appName,
          installedVersion: rec.installedVersion,
          latestVersion: rec.latestVersion,
          autoUpdate: rec.autoUpdate,
          status: rec.status || 'installed',
          syncUrl: rec.syncUrl || '',
          installedAt: rec.installedAt,
          lastUpdatedAt: rec.lastUpdatedAt,
        };
      }),
    });
  } catch (err) {
    logger.error('/apps GET error:', err);
    const status = pbErrorStatus(err);
    return res.status(status).json({
      error: 'Failed to fetch apps',
      ...(status === 503 ? { code: 'APPS_UNAVAILABLE', retryAfter: 5 } : {}),
    });
  }
});

router.post('/apps', requireUser, async (req: Request, res: Response) => {
  try {
    const { appId, appName, installedVersion, autoUpdate, syncUrl } = req.body;
    if (!appId || typeof appId !== 'string') return res.status(400).json({ error: 'appId is required' });

    // Optional per-install avatar-sync endpoint. Must be http(s); capped
    // at 500 chars (the PB text field limit). This is how a connected
    // app receives pushed avatar-change webhooks (instant cache
    // invalidation) in addition to the ?v=avatarVersion cache-bust.
    let normalizedSyncUrl = '';
    if (syncUrl) {
      if (typeof syncUrl !== 'string' || !/^https?:\/\//.test(syncUrl)) {
        return res.status(400).json({ error: 'syncUrl must be an http(s) URL' });
      }
      normalizedSyncUrl = syncUrl.slice(0, 500);
    }

    const pb = await getAdminPb();
    const existing = await pb.collection('user_apps').getList(1, 1, {
      filter: `userId="${escapePbFilterValue(req.user!.id)}" && appId="${escapePbFilterValue(appId)}"`,
    });

    if (existing.items.length > 0) {
      const updated = await pb.collection('user_apps').update(existing.items[0].id, {
        installedVersion: installedVersion || existing.items[0].installedVersion,
        appName: appName || existing.items[0].appName,
        autoUpdate: autoUpdate !== undefined ? autoUpdate : existing.items[0].autoUpdate,
        syncUrl: normalizedSyncUrl || existing.items[0].syncUrl,
        lastUpdatedAt: new Date().toISOString(),
        status: 'installed',
      });
      return res.status(200).json({ app: updated });
    }

    const created = await pb.collection('user_apps').create({
      userId: req.user!.id,
      appId,
      appName: appName || appId,
      installedVersion: installedVersion || '1.0.0',
      autoUpdate: autoUpdate !== undefined ? autoUpdate : true,
      ...(normalizedSyncUrl ? { syncUrl: normalizedSyncUrl } : {}),
      installedAt: new Date().toISOString(),
      status: 'installed',
    });

    return res.status(201).json({ app: created });
  } catch (err) {
    logger.error('/apps POST error:', err);
    return res.status(400).json({ error: 'Failed to register app' });
  }
});

router.delete('/apps/:appId', requireUser, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const pb = await getAdminPb();
    const existing = await pb.collection('user_apps').getList(1, 1, {
      filter: `userId="${escapePbFilterValue(req.user!.id)}" && appId="${escapePbFilterValue(appId)}"`,
    });

    if (existing.items.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    await pb.collection('user_apps').update(existing.items[0].id, {
      status: 'uninstalled',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('/apps DELETE error:', err);
    return res.status(500).json({ error: 'Failed to uninstall app' });
  }
});

// ─── Platform Directory ────────────────────────────────────────────
// Every surface in the thay ecosystem authenticated by thay-auth.
// Public — the homebase SPA renders the platform hub from this.

router.get('/platforms', async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ platforms: OFFICIAL_PLATFORMS });
  } catch (err) {
    logger.error('/platforms error:', err);
    return res.status(500).json({ error: 'Failed to fetch platforms' });
  }
});

// ─── Avatar Sync (cross-platform propagation) ──────────────────────
// When the canonical avatar changes (thaypley.com or auth.thaypley.com),
// every connected app must show the new photo. The PRIMARY mechanism is
// the ?v=avatarVersion cache-bust on the canonical URL — each app
// re-fetches the URL on its next profile refresh and gets the new
// image. This fan-out additionally PUSHES a signed webhook to apps that
// registered a sync endpoint (user_apps.syncUrl, or the env-configured
// AVATAR_SYNC_WEBHOOKS list), so they can invalidate in-memory caches
// immediately instead of waiting for the next profile poll.

interface AvatarSyncEvent {
  userId: string;
  avatarVersion: number;
  avatarUrl: string;
  app: string;
  endpoint: string;
}

const avatarSyncQueue = new BoundedQueue<AvatarSyncEvent>(
  async (evt) => {
    const hmac = crypto.createHmac('sha256', config.jwtSecret).update(
      `${evt.userId}.${evt.avatarVersion}.${evt.endpoint}`,
    ).digest('hex');
    await fetch(evt.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Thay-Sync': 'avatar',
        'X-Thay-Signature': `sha256=${hmac}`,
      },
      body: JSON.stringify({
        userId: evt.userId,
        avatarVersion: evt.avatarVersion,
        avatarUrl: evt.avatarUrl,
        app: evt.app,
      }),
      signal: AbortSignal.timeout(5000),
    });
  },
  {
    concurrency: 8,
    maxQueue: 500,
    onError: (err, evt) => {
      metrics.inc('thay_auth_avatar_sync_failures_total', { app: evt.app });
      logger.warn('avatar sync webhook failed', { app: evt.app, userId: evt.userId, error: err });
    },
    onDrop: () => metrics.inc('thay_auth_avatar_sync_dropped_total'),
  },
);

const avatarSyncEndpoints: string[] = (
  process.env.AVATAR_SYNC_WEBHOOKS || ''
).split(',').map((s) => s.trim()).filter(Boolean);

async function notifyAvatarSync(userId: string, version: number): Promise<void> {
  try {
    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(userId);
    const canonical = avatarUrl(user as unknown as Record<string, unknown>);
    const fullUrl = canonical ? `${canonical}${canonical.includes('?') ? '&' : '?'}v=${version}` : '';

    // 1) Global endpoints from env.
    for (const endpoint of avatarSyncEndpoints) {
      avatarSyncQueue.push({
        userId,
        avatarVersion: version,
        avatarUrl: fullUrl,
        app: 'global',
        endpoint,
      });
    }

    // 2) Per-install sync URLs (apps that registered one when pairing).
    const installs = await safeList(pb, 'user_apps', 1, 100, {
      filter: `userId="${escapePbFilterValue(userId)}"`,
    });
    for (const record of installs.items) {
      const rec = record as Record<string, unknown>;
      const syncUrl = rec.syncUrl as string;
      if (syncUrl && typeof syncUrl === 'string' && /^https?:\/\//.test(syncUrl)) {
        avatarSyncQueue.push({
          userId,
          avatarVersion: version,
          avatarUrl: fullUrl,
          app: (rec.appId as string) || 'unknown',
          endpoint: syncUrl,
        });
      }
    }
  } catch (err) {
    logger.warn('notifyAvatarSync setup failed (non-fatal)', { userId, error: err });
  }
}

// ─── Invite Code Management (architect-only) ───────────────────────
// thay architects mint invite codes from the hub UI or API. Public
// signup validation stays on POST /auth/check-invite.

const inviteCreateLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'auth-invite-create' });

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  const rand = crypto.randomBytes(8);
  for (let i = 0; i < 4; i++) {
    suffix += chars[rand[i] % chars.length];
  }
  return `${config.invite.codePrefix}-${suffix}`;
}

router.get('/invites', requireArchitect, async (_req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    // Cap perPage at PocketBase's default maxPerPage (200) so instances
    // without a raised maxPerPage don't reject the request.
    const invites = await safeList(pb, 'signup_invites', 1, 200, {
      sort: '-created',
    });
    return res.status(200).json({
      invites: invites.items.map((a: unknown) => {
        const rec = a as Record<string, unknown>;
        return {
          id: rec.id,
          code: rec.code,
          used: !!rec.used,
          usedBy: rec.usedBy || '',
          usedAt: rec.usedAt || '',
          maxUses: rec.maxUses || 1,
          useCount: rec.useCount || 0,
          note: rec.note || '',
          createdBy: rec.createdBy || '',
          createdAt: rec.created || '',
          expiresAt: rec.expiresAt || '',
        };
      }),
    });
  } catch (err) {
    logger.error('/invites GET error:', err);
    const status = pbErrorStatus(err);
    if (status === 503) {
      // Architect page renders a retry card and auto-recovers instead of
      // showing a permanent "something broke" state.
      return res.status(503).json({
        error: 'Failed to fetch invites',
        code: 'INVITES_UNAVAILABLE',
        retryAfter: 5,
      });
    }
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

router.post('/invites', inviteCreateLimit, requireArchitect, async (req: Request, res: Response) => {
  try {
    const { maxUses, note, expiresAt } = req.body || {};
    const uses = Math.max(1, Math.min(parseInt(String(maxUses ?? config.invite.defaultMaxUses), 10) || 1, 1000));
    const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';

    let expiry = '';
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid expiresAt date' });
      }
      expiry = parsed.toISOString();
    }

    const code = generateInviteCode();
    const pb = await getAdminPb();
    const created = await pb.collection('signup_invites').create({
      code,
      used: false,
      usedBy: '',
      usedAt: '',
      createdBy: req.user!.id,
      note: trimmedNote,
      maxUses: uses,
      useCount: 0,
      expiresAt: expiry,
    });

    return res.status(201).json({
      invite: {
        id: created.id,
        code,
        used: false,
        usedBy: '',
        usedAt: '',
        maxUses: uses,
        useCount: 0,
        note: trimmedNote,
        createdBy: req.user!.id,
        createdAt: created.created,
        expiresAt: expiry,
      },
    });
  } catch (err) {
    logger.error('/invites POST error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to create invite';
    return res.status(400).json({ error: msg });
  }
});

router.delete('/invites/:id', requireArchitect, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Invite id required' });
    const pb = await getAdminPb();
    await pb.collection('signup_invites').delete(id);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('/invites DELETE error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to delete invite';
    return res.status(400).json({ error: msg });
  }
});

// ─── Health ────────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const health = await pb.health.check();
    return res.status(200).json({
      status: 'ok',
      pocketbase: health,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      status: 'error',
      pocketbase: 'unreachable',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
