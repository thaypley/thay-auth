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
    downloads: { mac: '', windows: '', linux: '', web: 'https://tv.thaypley.com' },
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
  {
    slug: 'thay-locker', displayName: 'thay(locker)', tagline: 'your encrypted vault for everything',
    description: 'passwords, keys, files, and secrets — locked tight and syncable across devices.',
    isFree: true, price: 'Free', version: '1.0.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://locker.thaypley.com' },
    sortOrder: 15, published: true, family: 'core',
  },
  {
    slug: 'slashcat', displayName: '(slashcat) browser', tagline: 'a browser that thinks with you',
    description: 'the creator browser — command-first navigation, tab groups, and AI-assisted browsing built in.',
    isFree: true, price: 'Free', version: '0.9.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://slashcat.thaypley.com' },
    sortOrder: 16, published: true, family: 'core',
  },
  {
    slug: 'dabba-root', displayName: '(dabba) — root', tagline: 'the core assistant kernel',
    description: 'the root daemon that powers every dabba skill — local, private, always on.',
    isFree: true, price: 'Free', version: '0.6.2',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/dabba' },
    sortOrder: 17, published: true, family: 'dabba',
  },
  {
    slug: 'gab', displayName: '(gab)-skills', tagline: 'skills for your assistant',
    description: 'the (gab) skills marketplace — install personality, workflow, and automation skills into dabba.',
    isFree: true, price: 'Free', version: '0.4.0',
    downloads: { web: 'https://thaypley.com/dabba' },
    sortOrder: 18, published: true, family: 'dabba',
  },
  {
    slug: 'tabbi', displayName: 'tabbi(COS)', tagline: 'the cognitive operating system',
    description: 'an operating layer for thought — capture, structure, and retrieve everything your mind touches.',
    isFree: true, price: 'Free', version: '0.5.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/tabbi' },
    sortOrder: 19, published: true, family: 'tabbi',
  },
  {
    slug: 'webiverse', displayName: '(webiverse)', tagline: 'personal context infrastructure',
    description: 'your context graph — every note, link, and memory woven into one navigable universe.',
    isFree: true, price: 'Free', version: '0.5.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/webiverse' },
    sortOrder: 20, published: true, family: 'tabbi',
  },
  {
    slug: 'webispectral', displayName: '(webispectral)', tagline: 'protocol for minds, connected',
    description: 'the protocol layer — standard schemas and handshakes for sharing context between apps and agents.',
    isFree: true, price: 'Free', version: '0.2.0',
    downloads: { mac: '', windows: '', linux: '' },
    sortOrder: 21, published: true, family: 'tabbi',
  },
  {
    slug: 'thay-design', displayName: '(design)', tagline: 'graphic design, reimagined',
    description: 'vector, layout, and brand tools in one fluid canvas — made for creators who ship.',
    isFree: false, price: '$8/mo', version: '0.3.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/design' },
    sortOrder: 22, published: true, family: 'creative',
  },
  {
    slug: 'ls-photo', displayName: '(ls)photo', tagline: 'photo editing, light-speed',
    description: 'non-destructive RAW editing, layers, and film-grade color in a blazing-fast editor.',
    isFree: false, price: '$8/mo', version: '0.3.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/ls-photo' },
    sortOrder: 23, published: true, family: 'creative',
  },
  {
    slug: 'ls-video', displayName: '(ls)video', tagline: 'video editing, light-speed',
    description: 'timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.',
    isFree: false, price: '$10/mo', version: '0.3.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/ls-video' },
    sortOrder: 24, published: true, family: 'creative',
  },
  {
    slug: 'ls-effect', displayName: '(ls)effect', tagline: 'motion graphics & effects',
    description: 'compositing, particles, and typography in motion — the VFX surface for the thay universe.',
    isFree: false, price: '$10/mo', version: '0.2.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/ls-effect' },
    sortOrder: 25, published: true, family: 'creative',
  },
  {
    slug: 'thay-pattern', displayName: '(pattern)', tagline: 'fashion design studio',
    description: 'pattern drafting, textile simulation, and runway-ready presentation in one studio.',
    isFree: false, price: '$8/mo', version: '0.1.0',
    downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/pattern' },
    sortOrder: 26, published: true, family: 'creative',
  },
];

function classifyKind(row) {
  if (row.slug.includes('cli')) return 'cli';
  if (row.slug.includes('cloud')) return 'cloud';
  const d = row.downloads;
  if (d && typeof d === 'object' && !Array.isArray(d) && ('mac' in d || 'windows' in d || 'linux' in d)) return 'desktop';
  return 'web';
}

function familyOf(row) {
  const legacyFamily = {
    'dabba-cli': 'dabba',
    'dabba-desktop': 'dabba',
    'dabba-cloud': 'dabba',
    'studio': 'creative',
  }[row.slug];
  return row.family || legacyFamily || 'core';
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
      // PB ≥0.24: base collections have no implicit created/updated — the
      // app sorts devices by -created, so create them explicitly.
      { type: 'autodate', name: 'created', onCreate: true, onUpdate: false, hidden: false },
      { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true, hidden: false },
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

async function ensureAutodateFields(pb, collectionName, label) {
  let collection;
  try {
    collection = await pb.collections.getOne(collectionName);
  } catch (e) {
    if (e.status === 404) {
      console.log(`⚠ ${collectionName} collection missing — skipping ${label} autodate`);
      return;
    }
    throw e;
  }
  const createField = {
    type: 'autodate', name: 'created', onCreate: true, onUpdate: false, hidden: false,
  };
  const updateField = {
    type: 'autodate', name: 'updated', onCreate: true, onUpdate: true, hidden: false,
  };
  const missing = [];
  if (!hasField(collection, 'created')) missing.push(createField);
  if (!hasField(collection, 'updated')) missing.push(updateField);
  if (missing.length === 0) {
    console.log(`✓ ${label} autodate (created/updated) already present — nothing to do`);
    return;
  }
  const fresh = await pb.collections.getOne(collectionName);
  await pb.collections.update(collectionName, {
    fields: [...fresh.fields, ...missing],
  });
  for (const f of missing) console.log(`→ added ${collectionName}.${f.name} autodate`);
}

async function upsertCatalog(pb) {
  for (const app of CATALOG_APPS) {
    const kind = classifyKind(app);
    const family = familyOf(app);
    const payload = { ...app, kind, family };
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
        if (key === 'downloads' && value && typeof value === 'object' && current && typeof current === 'object') {
          // Merge download targets key-by-key so a row can gain (e.g.)
          // desktop builds without clobbering its live web URL — and so
          // a already-desktop row never loses existing download links.
          const merged = { ...value, ...current };
          const currentKeys = Object.keys(current);
          if (Object.keys(merged).length !== currentKeys.length || currentKeys.some((k) => !(k in value))) {
            updates.downloads = merged;
          }
          continue;
        }
        if (key === 'kind' && current !== value) {
          // Keep the stored kind in lockstep with the download-key
          // classification (desktop/cli/cloud/web) on live rows.
          updates.kind = value;
          continue;
        }
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

  // PB ≥0.24 stores base collections without implicit `created`/`updated`
  // autodate fields (they are only auto-added to AUTH collections). The app
  // sorts /devices, /auth/invites and /sessions by `-created`, which PB
  // rejects with 400 when the field is absent — so ensure them explicitly.
  await ensureAutodateFields(pb, 'devices', 'devices');
  await ensureAutodateFields(pb, 'signup_invites', 'signup_invites');
  await ensureAutodateFields(pb, 'sessions', 'sessions');
  await ensureAutodateFields(pb, 'user_apps', 'user_apps');
  await ensureAutodateFields(pb, 'catalog_apps', 'catalog_apps');

  await ensureField(pb, 'users', { name: 'avatarVersion', type: 'number', required: false, min: 0, max: 999999 }, 'users.avatarVersion');
  await ensureField(pb, 'user_apps', { name: 'syncUrl', type: 'text', required: false, max: 500 }, 'user_apps.syncUrl');
  await ensureField(pb, 'catalog_apps', { name: 'kind', type: 'text', required: false, max: 30 }, 'catalog_apps.kind');
  await ensureField(pb, 'catalog_apps', { name: 'family', type: 'text', required: false, max: 40 }, 'catalog_apps.family');

  await upsertCatalog(pb);

  console.log('\nDone. Schema + roster live and idempotent.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
