import { Router, Request, Response } from 'express';
import { getAdminPb } from '../providers/pocketbase.js';
import { requireUser } from '../middleware/requireAuth.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const sessions = await pb.collection('sessions').getFullList({
      filter: `userId="${req.user!.id}"`,
    });

    const result = (sessions as unknown as Record<string, unknown>[]).map(s => ({
      id: s.id,
      app: s.app || 'homebase',
      deviceId: s.deviceId,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.created,
      expiresAt: s.expiresAt,
      revoked: s.revoked || false,
    }));

    return res.status(200).json({ sessions: result });
  } catch (err) {
    logger.error('list sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.delete('/:id', requireUser, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pb = await getAdminPb();
    const session = await pb.collection('sessions').getOne(id).catch(() => null);

    if (!session) return res.status(404).json({ error: 'Session not found' });
    if ((session as unknown as Record<string, unknown>).userId !== req.user!.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pb.collection('sessions').update(id, { revoked: true });
    logger.info(`Session revoked: ${id} for user ${req.user!.id}`);
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to revoke session' });
  }
});

export default router;
