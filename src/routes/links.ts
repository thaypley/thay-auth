// Soul-to-Persona chain links. thay-auth is the single source of truth for identity.
// A soul (primary) account can chain-link persona/business accounts.
import { Router, Request, Response } from 'express';
import { getAdminPb } from '../providers/pocketbase.js';
import { requireUser } from '../middleware/requireAuth.js';
import { escapePbFilterValue } from '../utils/filterEscape.js';
import { logger } from '../utils/logger.js';

const router = Router();
const RELATIONS = ['business', 'artist_persona', 'label', 'studio', 'fan_persona', 'other'];
const COLL = 'account_links';

function rowToPublic(row: any) {
  return {
    id: row.id,
    soulId: row.soulId,
    linkedId: row.linkedId,
    relation: row.relation,
    status: row.status,
    note: row.note || '',
    created: row.created,
    updated: row.updated,
  };
}

router.get('/', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const uid = req.user!.id;
    const filter = '(soulId="' + escapePbFilterValue(uid) + '" || linkedId="' + escapePbFilterValue(uid) + '")';
    const rows = await pb.collection(COLL).getFullList({ filter, sort: '-created' });
    const items = rows.map(rowToPublic);
    const bios: Record<string, { username: string; accountType: string; avatar: string }> = {};
    for (const it of items) {
      const otherId = it.soulId === uid ? it.linkedId : it.soulId;
      if (!bios[otherId]) {
        try {
          const u: any = await pb.collection('users').getOne(otherId);
          bios[otherId] = {
            username: u.username || '',
            accountType: u.accountType || '',
            avatar: u.avatar ? '/api/files/users/' + u.id + '/' + u.avatar : '',
          };
        } catch {
          bios[otherId] = { username: 'unknown', accountType: '', avatar: '' };
        }
      }
    }
    return res.json({ links: items, bios, soul: req.user!.username });
  } catch (err) {
    logger.error('/links GET error:', err);
    return res.status(503).json({ error: 'Failed to load chain links' });
  }
});

router.post('/invite', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const uid = req.user!.id;
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const relation = typeof req.body.relation === 'string' ? req.body.relation : '';
    const note = typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : '';
    if (!username) return res.status(400).json({ error: 'username is required' });
    if (RELATIONS.indexOf(relation) === -1) {
      return res.status(400).json({ error: 'relation must be one of: ' + RELATIONS.join(', ') });
    }
    const targetName = username.toLowerCase();
    if (targetName === req.user!.username) {
      return res.status(400).json({ error: 'You cannot link an account to itself' });
    }
    const target = await pb.collection('users').getFirstListItem('username="' + escapePbFilterValue(targetName) + '"').catch(() => null);
    if (!target) return res.status(404).json({ error: 'No account found with that username' });
    const tid = (target as any).id;
    if (tid === uid) return res.status(400).json({ error: 'You cannot link an account to itself' });
    const dupe = await pb.collection(COLL).getFirstListItem('(soulId="' + uid + '" || linkedId="' + tid + '" || soulId="' + tid + '" || linkedId="' + uid + '")').catch(() => null);
    if (dupe) return res.status(409).json({ error: 'An account link already exists between these accounts' });
    const created = await pb.collection(COLL).create({
      soulId: uid,
      linkedId: tid,
      relation,
      status: 'pending',
      createdBy: uid,
      note,
    });
    logger.info('account-link invite: ' + req.user!.username + ' -> ' + targetName + ' (' + relation + ')');
    return res.status(201).json({ link: rowToPublic(created) });
  } catch (err) {
    logger.error('/links/invite error:', err);
    return res.status(503).json({ error: 'Failed to create link invite' });
  }
});

router.post('/:id/accept', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const uid = req.user!.id;
    const link: any = await pb.collection(COLL).getOne(req.params.id).catch(() => null);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.linkedId !== uid) return res.status(403).json({ error: 'Only the linked account can accept this invite' });
    if (link.status !== 'pending') return res.status(409).json({ error: 'This link is not pending' });
    const updated = await pb.collection(COLL).update(link.id, { status: 'linked' });
    logger.info('account-link accepted: ' + uid + ' accepted from soul ' + link.soulId);
    return res.json({ link: rowToPublic(updated) });
  } catch (err) {
    logger.error('/links/:id/accept error:', err);
    return res.status(503).json({ error: 'Failed to accept link' });
  }
});

router.post('/:id/decline', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const uid = req.user!.id;
    const link: any = await pb.collection(COLL).getOne(req.params.id).catch(() => null);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.linkedId !== uid) return res.status(403).json({ error: 'Only the linked account can decline this invite' });
    if (link.status !== 'pending') return res.status(409).json({ error: 'This link is not pending' });
    await pb.collection(COLL).delete(link.id);
    logger.info('account-link declined: ' + uid + ' declined from soul ' + link.soulId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('/links/:id/decline error:', err);
    return res.status(503).json({ error: 'Failed to decline link' });
  }
});

router.delete('/:id', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const uid = req.user!.id;
    const link: any = await pb.collection(COLL).getOne(req.params.id).catch(() => null);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.soulId !== uid && link.linkedId !== uid) {
      return res.status(403).json({ error: 'Only linked accounts can unlink' });
    }
    await pb.collection(COLL).delete(link.id);
    logger.info('account-link unlinked: ' + uid + ' unlinked ' + link.soulId + ' <-> ' + link.linkedId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('/links/:id DELETE error:', err);
    return res.status(503).json({ error: 'Failed to unlink' });
  }
});

export default router;
