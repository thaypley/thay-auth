import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getAdminPb, invalidateAdminPb } from '../providers/pocketbase.js';
import { signDeviceToken, verifyDeviceToken, type DeviceTokenPayload } from '../providers/jwt.js';
import { requireUser } from '../middleware/requireAuth.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { escapePbFilterValue } from '../utils/filterEscape.js';
import { SharedCache } from '../utils/sharedCache.js';

const router = Router();

// Allowlist of device token scopes — a client cannot invent scopes beyond
// what the platform defines.
const KNOWN_SCOPES = new Set(['relay:chat', 'relay:du']);

/**
 * L1+L2 cache for /devices/verify — the hot path for device heartbeats.
 * L1 serves steady-state heartbeats with ZERO PB reads; L2 (Redis, when
 * configured) propagates unpair/revoke across replicas on their next
 * local miss. Revocation is otherwise visible within the TTL (60s).
 */
interface CachedDevice {
  revoked: boolean;
  userId: string;
  expiresAt: string | null;
  lastSeenAt: number | null;
}

const deviceCache = new SharedCache<CachedDevice>({
  max: config.deviceCacheMax,
  ttlMs: config.deviceCacheTtlMs,
  prefix: 'thay:dev',
  name: 'device',
});

function invalidateDevice(deviceId: string): void {
  deviceCache.del(deviceId);
}

export const PAIRING_UNAVAILABLE = { error: "Device pairing is temporarily unavailable", code: "DEVICE_PAIRING_UNAVAILABLE" };

/**
 * Maps PB collection-missing (404) and transient auth
 * infrastructure errors (401/403) to a client-actionable 503.
 * Returns 0 when the error should surface as a real 500.
 */
export function pbUnavailable(err: unknown): number {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    invalidateAdminPb();
  }
  return status === 404 || status === 401 || status === 403 ? 503 : 0;
}

function normalizeScopes(scopes: unknown): string[] {
  const base = Array.isArray(scopes) ? scopes : [];
  const cleaned = base
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
  const seen = new Set<string>();
  return cleaned.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(64);
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(bytes[i] % chars.length);
  }
  return result;
}

router.post('/pair', requireUser, async (req: Request, res: Response) => {
  try {
    const { label, scopes } = req.body;
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'Device label is required' });
    }

    const normalizedScopes = normalizeScopes(scopes);
    const unknown = normalizedScopes.filter((s) => !KNOWN_SCOPES.has(s));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Unknown device scopes: ${unknown.join(', ')}` });
    }
    const finalScopes = normalizedScopes.length > 0 ? normalizedScopes : ['relay:chat', 'relay:du'];

    const pb = await getAdminPb();
    const token = generateToken();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expiresAt = new Date(Date.now() + config.tokenExpiryMs).toISOString();

    // Idempotent pairing: if an unrevoked device with this label already
    // exists for the user, re-sign a fresh token for it instead of creating
    // a duplicate row on every login.
    const existing = await pb.collection('devices').getList(1, 1, {
      filter: `userId="${escapePbFilterValue(req.user!.id)}" && label="${escapePbFilterValue(label.trim())}" && revoked=false`,
    });

    let device: Record<string, unknown>;
    if (existing.items.length > 0) {
      device = existing.items[0] as unknown as Record<string, unknown>;
      await pb.collection('devices').update(device.id as string, {
        tokenHash,
        scopes: finalScopes,
        expiresAt,
        lastSeenAt: new Date().toISOString(),
      });
    } else {
      device = await pb.collection('devices').create({
        userId: req.user!.id,
        tokenHash,
        label: label.trim(),
        scopes: finalScopes,
        expiresAt,
        revoked: false,
      });
    }
    invalidateDevice(device.id as string);

    const deviceToken = signDeviceToken(
      device.id as string,
      req.user!.id,
      finalScopes,
    );

    logger.debug(`Device paired: ${label} for user ${req.user!.id}`);

    return res.status(201).json({
      deviceToken,
      device: {
        id: device.id,
        label: device.label,
        scopes: device.scopes,
        expiresAt,
      },
    });
  } catch (err) {
    logger.error('pair device error:', err);
    const unavailable = pbUnavailable(err);
    if (unavailable) return res.status(unavailable).json(PAIRING_UNAVAILABLE);
    return res.status(500).json({ error: 'Failed to pair device' });
  }
});

router.delete('/unpair', requireUser, async (req: Request, res: Response) => {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken) {
      return res.status(400).json({ error: 'deviceToken is required' });
    }

    const payload = verifyDeviceToken(deviceToken);
    if (!payload) {
      return res.status(400).json({ error: 'Invalid device token' });
    }

    const pb = await getAdminPb();
    await pb.collection('devices').update(payload.deviceId, { revoked: true });
    invalidateDevice(payload.deviceId);

    logger.debug(`Device unpaired: ${payload.deviceId} for user ${req.user!.id}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('unpair device error:', err);
    const unavailable = pbUnavailable(err);
    if (unavailable) return res.status(unavailable).json(PAIRING_UNAVAILABLE);
    return res.status(500).json({ error: 'Failed to unpair device' });
  }
});

router.get('/', requireUser, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const perPage = Math.min(parseInt(req.query.per_page as string, 10) || 20, 50); // cap at 50

    const pb = await getAdminPb();
    // Resilient list: a missing `devices` collection on a fresh PB instance
    // must read as an empty list, not a 500 that takes down the whole
    // dashboard. PB auth failures (401/403) are transient infrastructure
    // errors → 503, which the UI can present as "try again shortly" instead
    // of "something broke".
    let devices;
    try {
      devices = await pb.collection('devices').getList(page, perPage, {
        filter: `userId="${escapePbFilterValue(req.user!.id)}"`,
        sort: '-created',
      });
    } catch (err) {
      const pbStatus = (err as { status?: number })?.status;
      // Missing collection (404) or schema drift / invalid sort on a fresh
      // or upgraded PB instance (400) must read as an empty list, not a 500
      // that takes down the whole dashboard.
      if (pbStatus === 404 || pbStatus === 400) {
        return res.status(200).json({
          devices: [],
          pagination: { page, perPage, total: 0, pages: 0 },
        });
      }
      if (pbStatus === 401 || pbStatus === 403) {
        invalidateAdminPb();
        return res.status(503).json({ error: 'Thay services are temporarily unavailable' });
      }
      throw err;
    }

    const result = (devices as unknown as Record<string, unknown>[]).map(d => ({
      id: d.id,
      label: d.label,
      scopes: d.scopes,
      lastSeenAt: d.lastSeenAt,
      expiresAt: d.expiresAt,
      revoked: d.revoked,
      // PocketBase's canonical created timestamp — PB uses `created`, not
      // `createdAt`, so surface it under the client-side name explicitly.
      createdAt: d.created,
    }));

    return res.status(200).json({
      devices: result,
      pagination: {
        page: devices.page,
        perPage: devices.perPage,
        total: devices.totalItems,
        pages: Math.ceil(devices.totalItems / devices.perPage),
      },
    });
  } catch (err) {
    logger.error('list devices error:', err);
    return res.status(500).json({ error: 'Failed to list devices' });
  }
});

/** Serve a verify response from a cached device entry (local or remote). */
function serveCachedDevice(
  deviceId: string,
  entry: CachedDevice,
  payload: DeviceTokenPayload,
  res: Response,
): Response {
  if (entry.revoked) {
    return res.status(401).json({ valid: false, error: 'Device not found or revoked' });
  }
  // Throttle the lastSeenAt write: at most once per throttle window per
  // device, fire-and-forget (the old code wrote on EVERY verify).
  if (entry.lastSeenAt === null || Date.now() - entry.lastSeenAt > config.deviceLastSeenThrottleMs) {
    entry.lastSeenAt = Date.now();
    void getAdminPb()
      .then((pb) => pb.collection('devices').update(deviceId, { lastSeenAt: new Date().toISOString() }))
      .catch(() => {
        metrics.inc('thay_auth_pb_errors_total', { op: 'deviceLastSeen' });
      });
  }
  return res.status(200).json({
    valid: true,
    userId: payload.userId,
    deviceId: payload.deviceId,
    scopes: payload.scopes,
    expiresAt: entry.expiresAt ?? null,
  });
}

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken) {
      return res.status(400).json({ error: 'deviceToken is required' });
    }

    const payload = verifyDeviceToken(deviceToken);
    if (!payload) {
      return res.status(401).json({ valid: false, error: 'Invalid or expired device token' });
    }

    // L1 hit: zero PB round trips on the steady-state heartbeat path.
    const local = deviceCache.get(payload.deviceId);
    if (local) {
      metrics.inc('thay_auth_cache_hits_total', { cache: 'device' });
      return serveCachedDevice(payload.deviceId, local, payload, res);
    }

    // L2 (Redis): cross-replica unpair/revoke propagation on local miss.
    const remote = await deviceCache.getRemote(payload.deviceId);
    if (remote) {
      deviceCache.set(payload.deviceId, remote);
      return serveCachedDevice(payload.deviceId, remote, payload, res);
    }
    metrics.inc('thay_auth_cache_misses_total', { cache: 'device' });

    const pb = await getAdminPb();
    const device = await pb.collection('devices').getOne(payload.deviceId).catch(() => null);

    if (!device || (device as unknown as Record<string, unknown>).revoked) {
      deviceCache.set(payload.deviceId, {
        revoked: true,
        userId: payload.userId,
        expiresAt: null,
        lastSeenAt: null,
      });
      return res.status(401).json({ valid: false, error: 'Device not found or revoked' });
    }

    const rec = device as unknown as Record<string, unknown>;
    deviceCache.set(payload.deviceId, {
      revoked: false,
      userId: payload.userId,
      expiresAt: (rec.expiresAt as string) ?? null,
      lastSeenAt: Date.now(),
    });

    // First verify after a cache miss writes lastSeen.
    void pb.collection('devices')
      .update(payload.deviceId, { lastSeenAt: new Date().toISOString() })
      .catch(() => {
        metrics.inc('thay_auth_pb_errors_total', { op: 'deviceLastSeen' });
      });

    return res.status(200).json({
      valid: true,
      userId: payload.userId,
      deviceId: payload.deviceId,
      scopes: payload.scopes,
      // The device's REAL expiry (set at pair time from config.tokenExpiryMs).
      expiresAt: (rec.expiresAt as string) ?? null,
    });
  } catch (err) {
    const unavailable = pbUnavailable(err);
    if (unavailable) {
      if ((err as { status?: number })?.status === 401 || (err as { status?: number })?.status === 403) {
        invalidateAdminPb();
      }
      return res.status(unavailable).json({ valid: false, code: "DEVICE_PAIRING_UNAVAILABLE", error: "Device verification is temporarily unavailable" });
    }
    logger.error('verify device error:', err);
    return res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});

export default router;
