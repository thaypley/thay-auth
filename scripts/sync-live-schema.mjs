#!/usr/bin/env node

/**
 * Live schema sync for migration 013 against the shared prod PocketBase.
 *
 * Same pattern as scripts/add-app-field-to-sessions.mjs and
 * scripts/seed-catalog-apps.mjs: the live `hcgi/platform` PocketBase
 * does NOT auto-run pb_migrations/ — new fields/rows for existing
 * collections go through the admin API instead. Uses the pocketbase SDK
 * (a production dependency shipped in the image) because old PB versions
 * expose admin auth on SDK-discovered routes that raw fetch can't guess.
 *
 * Applies, idempotently and safe to re-run:
 *   1. users.avatarVersion        (cross-platform avatar cache-bust)
 *   2. user_apps.syncUrl           (avatar-change webhook target)
 *   3. catalog_apps.kind           (desktop/cli/cloud/web grouping)
 *   4. Full catalog launch roster  (tunes, jot, chronometer, Dabba CLI,
 *      Dabba desktop, dabba-cloud, fam, werk, du, studio, savant, tv,
 *      universe, homebase) — upserts by slug, preserves empty-field
 *      placeholders.
 *
 * Usage: node scripts/sync-live-schema.mjs
 * Requires PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD (env or .env).
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
    slug: 'tunes', displayName: 'thay(tunes)', tagline: 'tunes — thaypley music',
    description: 'The thaypley music desktop app — stream, curate, and share your sound across the whole ecosystem. Auth via thay-auth.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://tunes.thaypley.com' },
    sortOrder: 1, published: true,
  },
  {
    slug: 'jot', displayName: 'thay(jot)', tagline: 'Capture the spark before it fades.',
    description: 'A free quick-capture notes app from thaypley — jot ideas, lyrics, and sketches on the fly. Desktop + web.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://jot.thaypley.com' },
    sortOrder: 2, published: true,
  },
  {
    slug: 'chronometer', displayName: '(chronometer)', tagline: 'Time, kept the thaypley way.',
    description: 'A free desktop utility from thaypley — precise time tracking and cosmic scheduling for creators.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://chronometer.thaypley.com' },
    sortOrder: 3, published: true,
  },
  {
    slug: 'dabba-cli', displayName: 'Dabba CLI', tagline: 'The thaypley command line.',
    description: 'Manage your thay-auth identity, pair devices, mint invites (architects), and drive every thaypley platform from the terminal.',
    isFree: true, price: 'Free', version: '0.1.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/dabba' },
    sortOrder: 4, published: true,
  },
  {
    slug: 'dabba-desktop', displayName: 'Dabba desktop', tagline: 'The thaypley control room.',
    description: 'Desktop companion for the Dabba ecosystem — device management, sync status, and every thay app in one place.',
    isFree: true, price: 'Free', version: '0.1.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/dabba' },
    sortOrder: 5, published: true,
  },
  {
    slug: 'dabba-cloud', displayName: 'dabba-cloud', tagline: 'Your thaypley cloud, everywhere.',
    description: 'Cloud sync + storage for the Dabba ecosystem — your data rides with your thay-auth identity across every device.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://cloud.thaypley.com' },
    sortOrder: 6, published: true,
  },
  {
    slug: 'fam', displayName: 'thay(fam)', tagline: 'The family side of thaypley.',
    description: 'Private family & inner-circle space — photos, moments, and updates for the people closest to you.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://fam.thaypley.com' },
    sortOrder: 7, published: true,
  },
  {
    slug: 'werk', displayName: 'thay(werk)', tagline: 'Work, the thaypley way.',
    description: 'Studio operations, projects, and collaboration for creators and their teams.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://werk.thaypley.com' },
    sortOrder: 8, published: true,
  },
  {
    slug: 'du', displayName: 'thay(du)', tagline: 'Du — together, the shared space.',
    description: 'The shared thaypley space — plans, collections, and moments built together.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://du.thaypley.com' },
    sortOrder: 9, published: true,
  },
  {
    slug: 'studio', displayName: 'thay(studio)', tagline: 'Create, capture, produce.',
    description: 'The creator studio desktop app — audio, video, and beats produced inside the thaypley ecosystem.',
    isFree: false, price: 'Creator', version: '1.0.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://studio.thaypley.com' },
    sortOrder: 10, published: true,
  },
  {
    slug: 'savant', displayName: 'thay(savant)', tagline: 'The knowledge side of thaypley.',
    description: 'Store, connect, and surface your knowledge across the ecosystem.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://savant.thaypley.com' },
    sortOrder: 11, published: true,
  },
  {
    slug: 'tv', displayName: 'thay(tv)', tagline: 'The screen side of thaypley.',
    description: 'Watch, share, and stream within the thaypley family.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://tv.thaypley.com' },
    sortOrder: 12, published: true,
  },
  {
    slug: 'universe', displayName: 'thay(universe)', tagline: 'Every thay world in one place.',
    description: 'The thaypley universe browser — all platforms, all worlds, one thay-auth identity.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { web: 'https://universe.thaypley.com' },
    sortOrder: 13, published: true,
  },
  {
    slug: 'homebase', displayName: 'thay(portal)', tagline: 'Your creator home base.',
    description: 'The portal — dashboards, apps, devices, and your thay-auth profile in one place. You are here.',
    isFree: true, price: 'Free', version: '2.0.0',
    downloads: { web: 'https://auth.thaypley.com' },
    sortOrder: 14, published: true,
  },
];

function classifyKind(row) {
  if (row.slug.includes('cli')) return 'cli';
  if (row.slug.includes('cloud')) return 'cloud';
  const d = row.downloads;
  if (d && typeof d === 'object' && !Array.isArray(d) && ('mac' in d || 'windows' in d || 'linux' in d)) return 'desktop';
  return 'web';
}

function isEmptyObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function hasField(collection, fieldName) {
  return collection.fields.some((f) => f.name === fieldName);
}

async function ensureDevicesCollection(pb) {
  try {
    await pb.collections.getOne('devices');
    console.log('✓ devices collection already exists — nothing to do');
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const users = await pb.collections.getOne('users');
  await pb.collections.create({
    name: 'devices',
    type: 'base',
    listRule: 'userId = @request.auth.id',
    viewRule: 'userId = @request.auth.id',
    createRule: 'userId = @request.auth.id',
    updateRule: 'userId = @request.auth.id',
    deleteRule: 'userId = @request.auth.id',
    fields: [
      { name: 'userId', type: 'relation', required: true, maxSelect: 1, collectionId: users.id },
      { name: 'tokenHash', type: 'text', required: true },
      { name: 'label', type: 'text', required: true, max: 100 },
      { name: 'scopes', type: 'json', required: false },
      { name: 'lastSeenAt', type: 'date', required: false },
      { name: 'expiresAt', type: 'date', required: false },
      { name: 'revoked', type: 'bool', required: false },
    ],
    indexes: ['CREATE INDEX idx_devices_user ON devices (userId)'],
  });
  console.log('→ created devices collection');
}

async function ensureField(pb, collectionName, field, label) {
  let collection;
  try {
    collection = await pb.collections.getOne(collectionName);
  } catch (e) {
    if (e.status === 404) {
      console.log(`⚠ ${collectionName} collection missing — skipping ${label}`);
      return;
    }
    throw e;
  }
  if (hasField(collection, field.name)) {
    console.log(`✓ ${label} already exists — nothing to do`);
    return;
  }
  await pb.collections.update(collectionName, { fields: [...collection.fields, field] });
  console.log(`→ added ${label}`);
}

async function upsertCatalog(pb) {
  for (const app of CATALOG_APPS) {
    const kind = classifyKind(app);
    const payload = { ...app, kind };
    let existing;
  try {
    existing = await pb.collection('catalog_apps').getList(1, 1, {
      filter: `slug="${app.slug}"`,
    });
    } catch (e) {
      if (e.status === 404) {
        console.log('⚠ catalog_apps collection missing — skipping catalog roster');
        return;
      }
      throw e;
    }
    if (existing.items.length > 0) {
      const rec = existing.items[0];
      const updates = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key === 'slug') continue;
        const current = rec[key];
        if (key === 'sortOrder' || current === null || current === undefined || current === '' || isEmptyObj(current)) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length > 0) {
        await pb.collection('catalog_apps').update(rec.id, updates);
      }
      console.log(`  ✓ ensured ${app.displayName} (kind: ${kind})`);
    } else {
      await pb.collection('catalog_apps').create(payload);
      console.log(`  ✓ created ${app.displayName} (kind: ${kind})`);
    }
  }
}

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('Authenticated as admin.\n');

  await ensureDevicesCollection(pb);

  await ensureField(pb, 'users', { name: 'avatarVersion', type: 'number', required: false, min: 0, max: 999999 }, 'users.avatarVersion');
  await ensureField(pb, 'user_apps', { name: 'syncUrl', type: 'text', required: false, max: 500 }, 'user_apps.syncUrl');
  await ensureField(pb, 'catalog_apps', { name: 'kind', type: 'text', required: false, max: 30 }, 'catalog_apps.kind');

  await upsertCatalog(pb);

  console.log('\nDone. Schema + roster live and idempotent.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
