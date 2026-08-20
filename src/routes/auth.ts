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
import {
  BASE_TRIAL_DAYS,
  isValidAppKey,
  summarizeEntitlements,
} from '../utils/entitlements.js';
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
    // 404 = collection missing on a fresh PB instance; 400/422 = schema
    // drift / invalid pagination on an upgraded instance. All should read as
    // an empty list rather than take down the whole endpoint.
    if (status === 404 || status === 400 || status === 422) {
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
  if (status === 401 || status === 403 || status === 404 || status === 400 || status === 422 || status === 0 || (typeof status === 'number' && status >= 500)) {
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
    // Deep identity fields — thay-auth is the single source of truth.
    // These round-trip through the shared users record so the auth portal
    // (homebase) can render and edit them exactly like thaypley.com does.
    displayName: record.displayName || '',
    website: record.website || '',
    socialLinks: record.socialLinks || '',
    location: record.location || '',
    vibe: record.vibe || '',
    relationship_status: record.relationship_status || '',
    relationshipVisible: record.relationshipVisible ?? true,
    partnerUsername: record.partnerUsername || '',
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
      family: rec.family || 'core',
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
  family: string;
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
    family: 'core',
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
    family: 'core',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thay-jot',
    displayName: 'thay(jot)',
    tagline: 'thoughts, captured at light speed',
    description: 'the note surface of the thay universe — markdown, sync, and collaborative linking across every app.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '2.3.1',
    kind: 'desktop',
    family: 'core',
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
    family: 'core',
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
    family: 'dabba',
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
    family: 'dabba',
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
    family: 'dabba',
    downloads: { web: '' },
  },
  {
    slug: 'thaypley-studio',
    displayName: '(studio)',
    tagline: 'create the whole universe',
    description: 'the creator engine — music, video, design, and publishing in one studio-grade surface.',
    iconUrl: '',
    isFree: false,
    price: '$12/mo',
    version: '1.0.0',
    kind: 'desktop',
    family: 'creative',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thay-locker',
    displayName: 'thay(locker)',
    tagline: 'your encrypted vault for everything',
    description: 'passwords, keys, files, and secrets — locked tight and syncable across devices.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '1.0.0',
    kind: 'desktop',
    family: 'core',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'slashcat',
    displayName: '(slashcat) browser',
    tagline: 'a browser that thinks with you',
    description: 'the creator browser — command-first navigation, tab groups, and AI-assisted browsing built in.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.9.0',
    kind: 'desktop',
    family: 'core',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'dabba-root',
    displayName: '(dabba) — root',
    tagline: 'the core assistant kernel',
    description: 'the root daemon that powers every dabba skill — local, private, always on.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.6.2',
    kind: 'desktop',
    family: 'dabba',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'gab',
    displayName: '(gab)-skills',
    tagline: 'skills for your assistant',
    description: 'the (gab) skills marketplace — install personality, workflow, and automation skills into dabba.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.4.0',
    kind: 'cloud',
    family: 'dabba',
    downloads: { web: '' },
  },
  {
    slug: 'tabbi',
    displayName: 'tabbi(COS)',
    tagline: 'the cognitive operating system',
    description: 'an operating layer for thought — capture, structure, and retrieve everything your mind touches.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.5.0',
    kind: 'desktop',
    family: 'tabbi',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'webiverse',
    displayName: '(webiverse)',
    tagline: 'personal context infrastructure',
    description: 'your context graph — every note, link, and memory woven into one navigable universe.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.5.0',
    kind: 'desktop',
    family: 'tabbi',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'webispectral',
    displayName: '(webispectral)',
    tagline: 'protocol for minds, connected',
    description: 'the protocol layer — standard schemas and handshakes for sharing context between apps and agents.',
    iconUrl: '',
    isFree: true,
    price: 'free',
    version: '0.2.0',
    kind: 'cli',
    family: 'tabbi',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thay-design',
    displayName: '(design)',
    tagline: 'graphic design, reimagined',
    description: 'vector, layout, and brand tools in one fluid canvas — made for creators who ship.',
    iconUrl: '',
    isFree: false,
    price: '$8/mo',
    version: '0.3.0',
    kind: 'desktop',
    family: 'creative',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'ls-photo',
    displayName: '(ls)photo',
    tagline: 'photo editing, light-speed',
    description: 'non-destructive RAW editing, layers, and film-grade color in a blazing-fast editor.',
    iconUrl: '',
    isFree: false,
    price: '$8/mo',
    version: '0.3.0',
    kind: 'desktop',
    family: 'creative',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'ls-video',
    displayName: '(ls)video',
    tagline: 'video editing, light-speed',
    description: 'timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.',
    iconUrl: '',
    isFree: false,
    price: '$10/mo',
    version: '0.3.0',
    kind: 'desktop',
    family: 'creative',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'ls-effect',
    displayName: '(ls)effect',
    tagline: 'motion graphics & effects',
    description: 'compositing, particles, and typography in motion — the VFX surface for the thay universe.',
    iconUrl: '',
    isFree: false,
    price: '$10/mo',
    version: '0.2.0',
    kind: 'desktop',
    family: 'creative',
    downloads: { mac: '', windows: '', linux: '' },
  },
  {
    slug: 'thay-pattern',
    displayName: '(pattern)',
    tagline: 'fashion design studio',
    description: 'pattern drafting, textile simulation, and runway-ready presentation in one studio.',
    iconUrl: '',
    isFree: false,
    price: '$8/mo',
    version: '0.1.0',
    kind: 'desktop',
    family: 'creative',
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
    const { email, password, username, accountType, birthday, inviteCode, app, name } = req.body;

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
        name: (name || '').trim(),
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
        name: (name || '').trim(),
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
    const { characteristics, profile } = req.body;
    const profilePatch: Record<string, string | number | boolean> = {};
    if (profile && typeof profile === 'object') {
      // Deep identity fields — thay-auth is the single source of truth.
      // thaypley.com settings writes these through here so they sync across
      // the whole family (auth portal, fam, werk, du, tunes, jot, dabba...).
      const pick = ['displayName', 'website', 'socialLinks', 'location', 'vibe',
        'relationship_status', 'relationshipVisible', 'partnerUsername'] as const;
      for (const key of pick) {
        if (typeof (profile as Record<string, unknown>)[key] === 'string') {
          profilePatch[key] = String((profile as Record<string, unknown>)[key]).slice(0, 2000);
        } else if (key === 'relationshipVisible' && typeof (profile as Record<string, unknown>)[key] === 'boolean') {
          profilePatch[key] = (profile as Record<string, unknown>)[key] as boolean;
        }
      }
    }
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

    if (Object.keys(profilePatch).length > 0) {
      try {
        await pb.collection('users').update(userId, profilePatch);
      } catch (patchErr) {
        logger.error('/profile PATCH users update error:', patchErr);
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
    // Public, read-only catalog: let the browser/CDN cache it (the server
    // already stale-while-revalidates behind getCatalogApps). Repeat
    // dashboard loads skip the network entirely.
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
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

// ── thay-sub plan model (2026-08 pivot) ─────────────────────────────
// There is no free tier anymore: base membership at $5/mo is the entry
// point, and architect accounts bypass every gate — they move freely
// across all thay-auth platforms and apps. Tier/perk detail beyond base
// is still being worked out; the legacy ladder (core/plus/pro/enterprise)
// keeps paying members' access transitionally via isLegacyPaidTier but
// is no longer sold from this surface.

export const SUBSCRIPTION_PLANS: Array<{
  id: string;
  name: string;
  monthly: number;
  blurb: string;
  features: string[];
  deviceLimit: number;
  architect?: boolean;
}> = [
  {
    id: 'base',
    name: 'thay base',
    monthly: 5,
    blurb: 'the thaypley.com membership',
    features: ['all thaypley.com platforms', '5 devices', 'community support'],
    deviceLimit: 5,
  },
  {
    id: 'architect',
    name: 'thay architect',
    monthly: -1,
    blurb: 'unrestricted — every platform & app',
    features: ['all thay-auth platforms & apps', 'unlimited devices', 'early features', 'direct line to the studio'],
    deviceLimit: -1,
    architect: true,
  },
];

type PublishedPlanId = 'base' | 'architect';

/**
 * Plans as served by GET /auth/subscription — the base plan gains the
 * entitlement status/trial fields the page renders (status, source,
 * trialEnd, trialDaysLeft) when the member is on base.
 */
type PlanWithStatus = (typeof SUBSCRIPTION_PLANS)[number] & {
  status?: 'active' | 'trialing' | 'past_due' | 'none';
  source?: 'subscription' | 'legacy_tier';
  trialEnd?: string;
  trialDaysLeft?: number;
};

function planById(id: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id) || null;
}

/**
 * Retired legacy ladder. No longer sold (checkout rejects it), but
 * in-flight Stripe sessions still reconcile to a legacy users.tier, which
 * entitlements counts as an active base membership transitionally.
 */
const LEGACY_TIERS = ['core', 'plus', 'pro', 'enterprise'] as const;

router.get('/subscription', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);
    const isArchitect = Boolean(user.isArchitect);

    // New-model tier resolution: architect | base (active/trialing) | none.
    // Base access comes from a membership row or — transitionally — a paid
    // legacy users.tier (core/plus/pro/enterprise). There is no free tier.
    const rows = await getSubscriptionRows(pb, userId);
    const ent = summarizeEntitlements(rows, {
      isArchitect,
      legacyTier: String(user.tier || ''),
    });
    const baseActive = ent.base.status === 'active' || ent.base.status === 'trialing';
    const tier: PublishedPlanId | 'none' = isArchitect ? 'architect' : (baseActive ? 'base' : 'none');

    let plan: PlanWithStatus | null = null;
    if (isArchitect) {
      plan = planById('architect');
    } else if (baseActive) {
      plan = {
        ...(planById('base') as NonNullable<ReturnType<typeof planById>>),
        status: ent.base.status,
        ...(ent.base.source ? { source: ent.base.source } : {}),
        ...(ent.base.trialEnd ? { trialEnd: ent.base.trialEnd } : {}),
        ...(ent.base.trialDaysLeft !== undefined ? { trialDaysLeft: ent.base.trialDaysLeft } : {}),
      };
    }

    // App purchases from the public catalog + legacy app_entitlements.
    // Architects own everything — they move freely across all apps.
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
        const owned = isArchitect || entitlements[rec.slug] === 'owned' || entitlements[rec.slug] === 'subscribed';
        return {
          slug: rec.slug,
          appName: rec.displayName,
          price: (rec.price === '0' || rec.price === '') ? 'one-time' : (rec.price || 'one-time'),
          owned,
          status: owned ? 'owned' : (entitlements[rec.slug] || 'none'),
        };
      });

    // Portal is driven by POST /auth/subscription/portal (creates a live
    // Stripe billing-portal session when configured) — never a stale GET link.
    const manageUrl = '';

    return res.status(200).json({
      tier,
      architect: isArchitect,
      plan,
      entitlements: ent,
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
    const body = req.body as { tier?: string; target?: string };

    // Membership path: base ($5/mo thaypley.com) or 'app:<slug>' add-on.
    // The UI sends tier:'base'; SDK/other callers may send target:'base'.
    const target = String(body.target || '');
    const tierArg = String(body.tier || '').toLowerCase();
    const isBase = target === 'base' || tierArg === 'base';
    if (isBase || target.startsWith('app:')) {
      if (target.startsWith('app:') && !isValidAppKey(target.slice(4))) {
        return res.status(400).json({ error: 'Invalid app key' });
      }
      const resolvedTarget = isBase ? 'base' : target;
      const email = (user.email as string) || '';
      const result = await createCheckoutSession({
        userId,
        email,
        tier: '',
        target: resolvedTarget as 'base' | `app:${string}`,
        successUrl: `${config.appBaseUrl}/#/billing?checkout=success&target=${encodeURIComponent(resolvedTarget)}`,
        cancelUrl: `${config.appBaseUrl}/#/billing?checkout=cancelled`,
      });
      // Mark intent on the row now; the webhook completes it. If the row
      // never activates, entitlement reads stay 'none' — incomplete never
      // passes a gate.
      await upsertSubscriptionRow(pb, {
        userId,
        kind: isBase ? 'base' : 'app',
        appKey: isBase ? '' : target.slice(4),
        status: 'incomplete',
        stripeCustomerId: (user.stripe_customer_id as string) || '',
      });
      invalidateUserCache(userId);
      return res.status(200).json({ url: result.url, mode: result.mode, sessionId: result.sessionId });
    }

    // The legacy ladder (core/plus/pro/enterprise) is retired and there is
    // no free tier — base membership is the only plan sold from here.
    return res.status(400).json({ error: 'Invalid plan — thay base ($5/mo) is the only paid tier' });
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

// ─── Membership: base paywall + app add-ons (2026-08 pivot) ─────────
// $5/mo base membership gates thaypley.com (30-day trial first); app
// add-ons unlock other thay apps à la carte. Architects bypass every
// gate. The `subscriptions` collection is canonical; users.tier is read
// transitionally until the legacy ladder retires.

const trialLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'auth-trial' });

async function getSubscriptionRows(
  pb: Awaited<ReturnType<typeof getAdminPb>>,
  userId: string,
): Promise<Record<string, unknown>[]> {
  const list = await safeList(pb, 'membership_subscriptions', 1, 100, {
    filter: `userId="${escapePbFilterValue(userId)}"`,
  });
  return list.items as unknown as Record<string, unknown>[];
}

type SubscriptionWrite = {
  userId: string;
  kind: 'base' | 'app';
  appKey?: string;
  status?: string;
  trialEnd?: string;
  currentPeriodEnd?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

async function upsertSubscriptionRow(pb: Awaited<ReturnType<typeof getAdminPb>>, w: SubscriptionWrite): Promise<void> {
  const appKey = w.appKey || '';
  const filter = `userId="${escapePbFilterValue(w.userId)}" && kind="${w.kind}" && appKey="${escapePbFilterValue(appKey)}"`;
  const existing = await safeList(pb, 'membership_subscriptions', 1, 1, { filter });
  const fields: Record<string, string> = {};
  if (w.status !== undefined) fields.status = w.status;
  if (w.trialEnd !== undefined) fields.trialEnd = w.trialEnd;
  if (w.currentPeriodEnd !== undefined) fields.currentPeriodEnd = w.currentPeriodEnd;
  if (w.stripeCustomerId !== undefined) fields.stripeCustomerId = w.stripeCustomerId;
  if (w.stripeSubscriptionId !== undefined) fields.stripeSubscriptionId = w.stripeSubscriptionId;
  if (Object.keys(fields).length === 0) return;
  if (existing.items.length) {
    const id = (existing.items[0] as { id: string }).id;
    await pb.collection('membership_subscriptions').update(id, fields).catch((err) => {
      logger.error('subscriptions upsert update failed', { userId: w.userId, err: String(err) });
    });
  } else {
    await pb.collection('membership_subscriptions').create({
      userId: w.userId,
      kind: w.kind,
      appKey,
      ...fields,
    }).catch((err) => {
      logger.error('subscriptions upsert create failed', { userId: w.userId, err: String(err) });
    });
  }
}

function mapStripeSubStatus(status: string): string {
  switch (status) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'canceled': return 'canceled';
    default: return 'incomplete';
  }
}

// THE entitlement read: every thay app (and the thaypley.com gate) calls
// this. Server-computed from subscriptions rows — clients never cache
// entitlement truth locally.
router.get('/entitlements', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);
    const rows = await getSubscriptionRows(pb, userId);
    const entitlements = summarizeEntitlements(rows, {
      isArchitect: Boolean(user.isArchitect),
      legacyTier: String(user.tier || 'free'),
    });
    return res.status(200).json(entitlements);
  } catch (err) {
    logger.error('/entitlements GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch entitlements' });
  }
});

// Idempotent trial start — the dotcom gate calls this on a member's first
// gated visit. One base row per user forever: re-invocations report the
// existing state instead of restarting the clock.
router.post('/subscription/start-trial', trialLimit, requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const userId = req.user!.id;
    const user = await getUserData(pb, userId);

    if (user.isArchitect) {
      return res.status(200).json({ ok: true, architect: true, entitlements: { architect: true, base: { status: 'active' }, apps: {} } });
    }

    const legacyTier = String(user.tier || 'free');
    const rows = await getSubscriptionRows(pb, userId);
    const existing = summarizeEntitlements(rows, { legacyTier });
    if (existing.base.status !== 'none') {
      return res.status(200).json({ ok: true, alreadyStarted: true, entitlements: existing });
    }

    const trialEnd = new Date(Date.now() + BASE_TRIAL_DAYS * 86_400_000).toISOString();
    await upsertSubscriptionRow(pb, { userId, kind: 'base', appKey: '', status: 'trialing', trialEnd });
    logger.info('Base trial started', { userId, trialEnd });
    return res.status(200).json({
      ok: true,
      entitlements: {
        architect: false,
        base: { status: 'trialing', trialEnd, trialDaysLeft: BASE_TRIAL_DAYS, source: 'subscription' },
        apps: {},
        // The trial is the free test point — spread across all platforms
        // and apps for the trial window.
        trialCoversAll: true,
      },
    });
  } catch (err) {
    logger.error('/subscription/start-trial POST error:', err);
    return res.status(500).json({ error: 'Failed to start trial' });
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
    for (const ev of events as Array<{ type?: string; id?: string; data?: { object?: Record<string, unknown> } }>) {
      const type = String(ev.type || '');
      const data = (ev.data?.object || {}) as Record<string, any>;
      const eventId = String(ev.id || '');
      const pb = await getAdminPb();
      if (eventId) {
        // Idempotency ledger — Stripe retries aggressively; a replayed event
        // must never re-apply an entitlement mutation. Unique index on
        // eventId makes the create fail on the second delivery. A ledger
        // FAILURE (missing collection, PB down) must not silently disable
        // billing: check whether it's a true duplicate, and otherwise log
        // loudly + process anyway — the mutations are idempotent upserts
        // keyed on (userId, kind, appKey).
        try {
          await pb.collection('billing_webhook_events').create({ eventId, eventType: type.slice(0, 120) });
        } catch (err) {
          const seen = await safeList(pb, 'billing_webhook_events', 1, 1, {
            filter: `eventId="${escapePbFilterValue(eventId)}"`,
          }).catch(() => ({ items: [] as unknown[] }));
          if (seen.items.length) continue; // true duplicate — skip
          logger.error('billing ledger write failed — processing without idempotency guard', { eventId, type, err: String(err) });
        }
      }
      const userId = String(data.client_reference_id || '')
        || String(data.metadata?.userId || '')
        || String(data.customer_metadata?.userId || '');
      if (!userId) continue;
      let user: Record<string, unknown>;
      try {
        user = await getUserData(pb, userId);
      } catch {
        logger.warn('Webhook referenced unknown user', { userId });
        continue;
      }
      // Membership events (plan=base|app from checkout metadata) reconcile
      // `subscriptions` rows; legacy ladder events keep the users.tier path.
      // The two must not cross: a base purchase never grants a legacy tier.
      const plan = String(data.metadata?.plan || '');
      const appKey = String(data.metadata?.appKey || '');
      if (plan === 'base' || plan === 'app') {
        const kind = plan === 'base' ? 'base' as const : 'app' as const;
        const key = kind === 'base' ? '' : appKey;
        if (type === 'checkout.session.completed') {
          await upsertSubscriptionRow(pb, {
            userId, kind, appKey: key,
            status: 'active',
            trialEnd: '',
            stripeCustomerId: String(data.customer || ''),
            stripeSubscriptionId: String(data.subscription || ''),
          });
          if (data.customer) {
            await pb.collection('users').update(userId, { stripe_customer_id: String(data.customer) }).catch(() => undefined);
          }
          invalidateUserCache(userId);
          logger.info('Webhook activated membership', { userId, plan, appKey: key });
        } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
          const status = mapStripeSubStatus(String(data.status || 'active'));
          const periodEnd = data.current_period_end
            ? new Date(Number(data.current_period_end) * 1000).toISOString()
            : '';
          await upsertSubscriptionRow(pb, {
            userId, kind, appKey: key,
            status,
            currentPeriodEnd: periodEnd,
            stripeCustomerId: String(data.customer || ''),
            stripeSubscriptionId: String(data.id || ''),
          });
          invalidateUserCache(userId);
        } else if (type === 'customer.subscription.deleted') {
          await upsertSubscriptionRow(pb, { userId, kind, appKey: key, status: 'canceled' });
          invalidateUserCache(userId);
          logger.info('Webhook canceled membership', { userId, plan, appKey: key });
        } else if (type === 'checkout.session.expired') {
          await upsertSubscriptionRow(pb, { userId, kind, appKey: key, status: 'canceled' });
        }
      } else if (type === 'checkout.session.completed' || type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
        const tier = String(data.metadata?.tier || user.pending_tier || 'pro');
        const subId = String(data.subscription || data.id || user.stripe_subscription_id || '');
        const customerId = String(data.customer || user.stripe_customer_id || '');
        const finalTier = LEGACY_TIERS.includes(tier as (typeof LEGACY_TIERS)[number]) ? tier : 'pro';
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
    // Static directory data — cache aggressively at the CDN/browser so
    // the dashboard's platform strip never costs a server round trip.
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=1800');
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

// ─── Weather proxy ─────────────────────────────────────────────────
// Server-side Open-Meteo fetch so the SPA never makes a third-party
// request (ad-blockers in desktop webviews kill direct browser fetches
// with ERR_BLOCKED_BY_CLIENT). 15-minute in-memory cache keyed on the
// rounded coordinates; Node 18+ global fetch, zero new deps.

const weatherCache = new LRUCache<string, { weatherCode: number; temperature: number; windSpeed: number; updatedAt: string }>({
  max: 500,
  ttl: 15 * 60 * 1000,
});

function roundCoord(v: number): number { return Math.round(v * 100) / 100; }

router.get('/weather', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(String(req.query.lat ?? ''));
    const lon = parseFloat(String(req.query.lon ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'lat and lon are required numbers' });
    }

    // Round to ~1km so nearby refreshes share one cache entry.
    const key = `${roundCoord(lat)},${roundCoord(lon)}`;
    const cached = weatherCache.get(key);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=weather_code,temperature_2m,wind_speed_10m&wind_speed_unit=mph`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) {
      logger.warn('Open-Meteo upstream failed', { status: upstream.status });
      return res.status(503).json({ code: 'WEATHER_UNAVAILABLE', error: 'Weather is temporarily unavailable' });
    }
    const data = await upstream.json() as {
      current?: { weather_code?: number; temperature_2m?: number; wind_speed_10m?: number };
    };
    const current = data.current ?? {};
    const weatherCode = Number(current.weather_code) || 0;
    const temperature = Number(current.temperature_2m) || 0;
    const windSpeed = Number(current.wind_speed_10m) || 0;

    const payload = {
      weatherCode,
      temperature,
      windSpeed,
      updatedAt: new Date().toISOString(),
      cached: false,
    };
    weatherCache.set(key, {
      weatherCode,
      temperature,
      windSpeed,
      updatedAt: payload.updatedAt,
    });
    return res.status(200).json(payload);
  } catch (err) {
    logger.warn('weather proxy failed', err);
    return res.status(503).json({ code: 'WEATHER_UNAVAILABLE', error: 'Weather is temporarily unavailable' });
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
