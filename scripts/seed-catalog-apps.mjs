#!/usr/bin/env node

/**
 * Seed/upsert the public app catalog (chronometer, jot, ...) into
 * PocketBase directly via the admin API.
 *
 * Why a script and not just `pb_migrations/010_create_catalog_apps.js`:
 * per TODO.md, the live `hcgi/platform` PocketBase is a shared 200+
 * collection production instance that migrations are NOT run against
 * directly — new collections (user_characteristics, user_apps) were
 * created there by hand via the superuser API. This script follows that
 * same established pattern so it's safe to run against prod.
 *
 * Usage: node scripts/seed-catalog-apps.mjs
 * Requires PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD in environment or .env.
 * Idempotent — safe to re-run; upserts by slug.
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

const CATALOG_APPS = [
  {
    slug: 'chronometer',
    displayName: '(chronometer)',
    tagline: 'Time, kept the thaypley way.',
    description: 'A free desktop utility from thaypley — precise time tracking and cosmic scheduling for creators.',
    iconUrl: '',
    isFree: true,
    price: 'Free',
    version: '1.0.0',
    downloads: {},
    sortOrder: 1,
    published: true,
  },
  {
    slug: 'jot',
    displayName: 'thay(jot)',
    tagline: 'Capture the spark before it fades.',
    description: 'A free quick-capture notes app from thaypley — jot ideas, lyrics, and sketches on the fly.',
    iconUrl: '',
    isFree: true,
    price: 'Free',
    version: '1.0.0',
    downloads: {},
    sortOrder: 2,
    published: true,
  },
];

async function ensureCollection(pb) {
  try {
    await pb.collections.getOne('catalog_apps');
    console.log('✓ catalog_apps collection already exists');
    return;
  } catch (err) {
    if (err?.status !== 404) throw err;
  }

  console.log('→ creating catalog_apps collection...');
  await pb.collections.create({
    name: 'catalog_apps',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'slug', type: 'text', required: true, max: 100 },
      { name: 'displayName', type: 'text', required: true, max: 200 },
      { name: 'tagline', type: 'text', required: false, max: 200 },
      { name: 'description', type: 'text', required: false, max: 2000 },
      { name: 'iconUrl', type: 'url', required: false },
      { name: 'isFree', type: 'bool', required: false },
      { name: 'price', type: 'text', required: false, max: 50 },
      { name: 'version', type: 'text', required: false, max: 50 },
      { name: 'downloads', type: 'json', required: false, maxSize: 5000 },
      { name: 'sortOrder', type: 'number', required: false },
      { name: 'published', type: 'bool', required: false },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_catalog_apps_slug ON catalog_apps (slug)'],
  });
  console.log('✓ catalog_apps collection created');
}

async function upsertApps(pb) {
  for (const app of CATALOG_APPS) {
    const existing = await pb.collection('catalog_apps').getList(1, 1, {
      filter: `slug="${app.slug}"`,
    });
    if (existing.items.length > 0) {
      await pb.collection('catalog_apps').update(existing.items[0].id, app);
      console.log(`  ✓ updated ${app.displayName}`);
    } else {
      await pb.collection('catalog_apps').create(app);
      console.log(`  ✓ created ${app.displayName}`);
    }
  }
}

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('Authenticated as admin.\n');

  await ensureCollection(pb);
  await upsertApps(pb);

  console.log('\nDone. Catalog live at GET /auth/catalog');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
