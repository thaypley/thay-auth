import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getAdminPb } from '../providers/pocketbase.js';
import { signDeviceToken, verifyDeviceToken } from '../providers/jwt.js';
import { requireUser } from '../middleware/requireAuth.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { escapePbFilterValue } from '../utils/filterEscape.js';

const router = Router();

// Allowlist of device token scopes — a client cannot invent scopes beyond
// what the platform defines. Add new scopes here as surfaces onboard.
const KNOWN_SCOPES = new Set(['relay:chat', 'relay:du']);

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

    const deviceToken = signDeviceToken(
      device.id as string,
      req.user!.id,
      finalScopes,
    );

    logger.info(`Device paired: ${label} for user ${req.user!.id}`);

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

    logger.info(`Device unpaired: ${payload.deviceId} for user ${req.user!.id}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('unpair device error:', err);
    return res.status(500).json({ error: 'Failed to unpair device' });
  }
});

router.get('/', requireUser, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const perPage = Math.min(parseInt(req.query.per_page as string, 10) || 20, 50); // cap at 50

    const pb = await getAdminPb();
    const devices = await pb.collection('devices').getList(page, perPage, {
      filter: `userId="${escapePbFilterValue(req.user!.id)}"`,
      sort: '-createdAt',
    });

    const result = (devices as unknown as Record<string, unknown>[]).map(d => ({
      id: d.id,
      label: d.label,
      scopes: d.scopes,
      lastSeenAt: d.lastSeenAt,
      expiresAt: d.expiresAt,
      revoked: d.revoked,
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

    const pb = await getAdminPb();
    const device = await pb.collection('devices').getOne(payload.deviceId).catch(() => null);

    if (!device || (device as unknown as Record<string, unknown>).revoked) {
      return res.status(401).json({ valid: false, error: 'Device not found or revoked' });
    }

    await pb.collection('devices').update(payload.deviceId, {
      lastSeenAt: new Date().toISOString(),
    });

    return res.status(200).json({
      valid: true,
      userId: payload.userId,
      deviceId: payload.deviceId,
      scopes: payload.scopes,
      // The device's REAL expiry (set at pair time from config.tokenExpiryMs).
      // Consumers (the dabba brain's du_paired_devices self-heal) record this
      // instead of mirroring the TTL constant themselves — one source of truth.
      expiresAt: (device as unknown as Record<string, unknown>).expiresAt ?? null,
    });
  } catch {
    return res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});

export default router;
