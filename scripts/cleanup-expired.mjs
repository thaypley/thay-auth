#!/usr/bin/env node
/**
 * cleanup-expired.mjs — purge expired/revoked sessions, devices, and used
 * or expired auth codes from PocketBase.
 *
 * Intended to run on a schedule (cron). Safe to re-run: every query is
 * idempotent. Uses the admin API so it works against any PB instance the
 * service can reach, no direct DB access required.
 *
 * Usage:
 *   PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/cleanup-expired.mjs
 */

import PocketBase from 'pocketbase';
import 'dotenv/config';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');
  process.exit(1);
}

// Grace period keeps rows around briefly so /sessions and /devices can show
// "signed out" entries without instantly vanishing.
const REVOKED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const NOW = new Date().toISOString();
const REVOKED_CUTOFF = new Date(Date.now() - REVOKED_GRACE_MS).toISOString();

const pb = new PocketBase(PB_URL);

async function cleanupCollection(name, filter) {
  try {
    let total = 0;
    for (let page = 1; ; page++) {
      const result = await pb.collection(name).getList(page, 200, { filter });
      const items = result.items;
      for (const item of items) {
        await pb.collection(name).delete(item.id);
        total++;
      }
      if (result.page >= result.totalPages || items.length === 0) break;
    }
    return total;
  } catch (err) {
    if (err?.status === 404) {
      console.log(`[skip] ${name} collection not present on this PB instance`);
      return 0;
    }
    throw err;
  }
}

async function main() {
  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`[cleanup] started ${NOW}`);

  // Sessions: expired, or revoked longer ago than the grace period.
  const expiredSessions = await cleanupCollection('sessions', `expiresAt < "${NOW}"`);
  const revokedSessions = await cleanupCollection('sessions', `revoked = true && expiresAt < "${REVOKED_CUTOFF}"`);
  console.log(`[cleanup] sessions: ${expiredSessions + revokedSessions} removed`);

  // Devices: expired, or revoked beyond the grace window.
  const expiredDevices = await cleanupCollection('devices', `expiresAt < "${NOW}"`);
  const revokedDevices = await cleanupCollection('devices', `revoked = true && expiresAt < "${REVOKED_CUTOFF}"`);
  console.log(`[cleanup] devices: ${expiredDevices + revokedDevices} removed`);

  // Auth codes: used, or past expiry.
  const usedCodes = await cleanupCollection('auth_codes', 'used = true');
  const expiredCodes = await cleanupCollection('auth_codes', `expiresAt < "${NOW}"`);
  console.log(`[cleanup] auth_codes: ${usedCodes + expiredCodes} removed`);

  console.log('[cleanup] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[cleanup] failed:', err);
  process.exit(1);
});
