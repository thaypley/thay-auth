import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface DeviceTokenPayload {
  type: 'device';
  deviceId: string;
  userId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
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
