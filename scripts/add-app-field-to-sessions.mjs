#!/usr/bin/env node

/**
 * Adds the `app` field to the existing `sessions` collection on the live
 * PocketBase instance — same rationale as scripts/seed-catalog-apps.mjs:
 * migrations aren't run directly against `hcgi/platform`, so schema
 * changes to collections that already exist there go through this kind
 * of one-off admin-API script instead.
 *
 * Part of ARCHITECTURE_TOKEN_SCOPING.md step 1 — idempotent, safe to re-run.
 *
 * Usage: node scripts/add-app-field-to-sessions.mjs
 * Requires PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD in environment or .env.
 */

import 'dotenv/config';
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set');
  process.exit(1);
}

const APP_VALUES = ['homebase', 'tunes', 'tv', 'studio', 'savant', 'universe', 'portfolio'];

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('Authenticated as admin.\n');

  const collection = await pb.collections.getOne('sessions');
  const hasAppField = collection.fields.some((f) => f.name === 'app');

  if (hasAppField) {
    console.log('✓ sessions.app already exists — nothing to do');
    return;
  }

  console.log('→ adding "app" field to sessions collection...');
  const updatedFields = [
    ...collection.fields,
    { name: 'app', type: 'select', required: false, maxSelect: 1, values: APP_VALUES },
  ];
  await pb.collections.update('sessions', { fields: updatedFields });
  console.log('✓ sessions.app added');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
