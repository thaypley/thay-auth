import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppSlug } from '../utils/apps.js';

export interface DeviceTokenPayload {
  type: 'device';
  deviceId: string;
  userId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

// Wrapper user session token (ARCHITECTURE_TOKEN_SCOPING.md, option a):
// a thay-auth-signed JWT that carries the app the session was issued for
// (`aud`) plus the underlying PocketBase token, so requireUser can enforce
// per-app audience without trusting a raw PB token that names no app.
export interface UserTokenPayload {
  type: 'user';
  sub: string;
  aud: AppSlug;
  pbToken: string;
  iat?: number;
  exp?: number;
}

export function signUserToken(sub: string, aud: AppSlug, pbToken: string): string {
  const payload: Omit<UserTokenPayload, 'iat' | 'exp'> = { type: 'user', sub, aud, pbToken };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyUserToken(token: string): UserTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as UserTokenPayload;
    if (decoded.type !== 'user' || !decoded.pbToken || !decoded.aud) return null;
    return decoded;
  } catch (err) {
    logger.warn('User token verification failed:', err);
    return null;
  }
}

export function signDeviceToken(deviceId: string, userId: string, scopes: string[] = []): string {
  const payload: Omit<DeviceTokenPayload, 'iat' | 'exp'> = {
    type: 'device',
    deviceId,
    userId,
    scopes,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyDeviceToken(token: string): DeviceTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as DeviceTokenPayload;
    if (decoded.type !== 'device') return null;
    return decoded;
  } catch (err) {
    logger.warn('Device token verification failed:', err);
    return null;
  }
}
