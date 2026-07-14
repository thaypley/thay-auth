#!/usr/bin/env node

/**
 * Seed invite codes into thay-auth's PocketBase instance.
 * Usage: node scripts/seed-invites.mjs [--count N] [--prefix TP]
 *
 * Requires PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD in environment
 * or .env file in project root.
 */

import 'dotenv/config';
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8091';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const PREFIX = process.env.INVITE_CODE_PREFIX || 'TP';
const COUNT = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || '5', 10);
const MAX_USES = parseInt(process.argv.find(a => a.startsWith('--max-uses='))?.split('=')[1] || '1', 10);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set');
  process.exit(1);
}

function generateCode(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix + '-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);

  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('Authenticated as admin.\n');

  const existing = await pb.collection('signup_invites').getFullList();
  console.log(`Existing invites: ${existing.length}\n`);

  const created = [];
  for (let i = 0; i < COUNT; i++) {
    const code = generateCode(PREFIX);
    try {
      const invite = await pb.collection('signup_invites').create({
        code,
        used: false,
        maxUses: MAX_USES,
        useCount: 0,
        note: `Seeded by script on ${new Date().toISOString().split('T')[0]}`,
      });
      created.push(code);
      console.log(`  ✓ ${code}`);
    } catch (err) {
      console.error(`  ✗ Failed to create ${code}:`, err.message);
    }
  }

  console.log(`\nCreated ${created.length} invite codes.`);
  console.log('Add --apply or set up manually via PB Admin UI.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
