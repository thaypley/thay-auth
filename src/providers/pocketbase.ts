import PocketBase from 'pocketbase';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let adminPb: PocketBase | null = null;
let lastAuthTime = 0;
const AUTH_REFRESH_MS = 25 * 60 * 1000;

export function createClient(url?: string): PocketBase {
  return new PocketBase(url || config.pbUrl);
}

export async function getAdminPb(): Promise<PocketBase> {
  const now = Date.now();
  if (!adminPb || (now - lastAuthTime) > AUTH_REFRESH_MS) {
    const pb = createClient();
    try {
      await pb.admins.authWithPassword(config.pbAdminEmail, config.pbAdminPassword);
      adminPb = pb;
      lastAuthTime = now;
      logger.info('Admin PocketBase client authenticated');
    } catch (err) {
      logger.error('Failed to authenticate admin PocketBase client:', err);
      throw err;
    }
  }
  return adminPb;
}

export async function verifyUserToken(token: string): Promise<{ user: Record<string, unknown>; pb: PocketBase } | null> {
  try {
    const pb = createClient();
    pb.authStore.save(token, null);
    const authData = await pb.collection('users').authRefresh();
    return { user: authData.record as unknown as Record<string, unknown>, pb };
  } catch {
    return null;
  }
}

export async function findUserByEmail(email: string): Promise<Record<string, unknown> | null> {
  try {
    const pb = await getAdminPb();
    const result = await pb.collection('users').getList(1, 1, {
      filter: `email="${email.toLowerCase().trim()}"`,
    });
    return result.items[0] as unknown as Record<string, unknown> || null;
  } catch {
    return null;
  }
}

export async function findUserByUsername(username: string): Promise<Record<string, unknown> | null> {
  try {
    const pb = await getAdminPb();
    const result = await pb.collection('users').getList(1, 1, {
      filter: `username="${username.toLowerCase().trim()}"`,
    });
    return result.items[0] as unknown as Record<string, unknown> || null;
  } catch {
    return null;
  }
}
