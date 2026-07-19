import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getAdminPb } from '../providers/pocketbase.js';
import { signDeviceToken, verifyDeviceToken } from '../providers/jwt.js';
import { requireUser } from '../middleware/requireAuth.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const router = Router();

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

    const pb = await getAdminPb();
    const token = generateToken();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expiresAt = new Date(Date.now() + config.tokenExpiryMs).toISOString();

    const device = await pb.collection('devices').create({
      userId: req.user!.id,
      tokenHash,
      label: label.trim(),
      scopes: scopes || ['relay:chat', 'relay:du'],
      expiresAt,
      revoked: false,
    });

    const deviceToken = signDeviceToken(
      device.id as string,
      req.user!.id,
      scopes || ['relay:chat', 'relay:du'],
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
    const pb = await getAdminPb();
    const devices = await pb.collection('devices').getFullList({
      filter: `userId="${req.user!.id}"`,
    });

    const result = (devices as unknown as Record<string, unknown>[]).map(d => ({
      id: d.id,
      label: d.label,
      scopes: d.scopes,
      lastSeenAt: d.lastSeenAt,
      expiresAt: d.expiresAt,
      revoked: d.revoked || false,
      created: d.created,
    }));

    return res.status(200).json({ devices: result });
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
    });
  } catch {
    return res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});

export default router;
