import { Request, Response, NextFunction } from 'express';
import type PocketBase from 'pocketbase';
import { verifyUserToken } from '../providers/pocketbase.js';
import { verifyDeviceToken } from '../providers/jwt.js';
import { hashToken } from '../utils/hashToken.js';
import { logger } from '../utils/logger.js';

async function isSessionRevoked(pb: PocketBase, token: string): Promise<boolean> {
  try {
    const match = await pb.collection('sessions').getList(1, 1, {
      filter: `tokenHash="${hashToken(token)}"`,
    });
    if (match.items.length === 0) return false;
    return !!(match.items[0] as unknown as Record<string, unknown>).revoked;
  } catch (err) {
    logger.warn('isSessionRevoked check failed — failing open', { error: err });
    return false;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  [key: string]: unknown;
}

export interface AuthDevice {
  deviceId: string;
  userId: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      device?: AuthDevice;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }

  const result = await verifyUserToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (await isSessionRevoked(result.pb, token)) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  req.user = {
    id: result.user.id as string,
    email: result.user.email as string,
    username: result.user.username as string,
    ...result.user,
  };
  next();
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }

  const payload = verifyDeviceToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired device token' });
  }

  req.device = {
    deviceId: payload.deviceId,
    userId: payload.userId,
    scopes: payload.scopes,
  };
  next();
}

export function optionalUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) return next();

  verifyUserToken(token).then(result => {
    if (result) {
      req.user = {
        id: result.user.id as string,
        email: result.user.email as string,
        username: result.user.username as string,
        ...result.user,
      };
    }
    next();
  }).catch(() => next());
}
