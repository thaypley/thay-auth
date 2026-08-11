migrate((app) => {
  // ── users.avatarVersion ─────────────────────────────────────────
  // Cross-platform cache-bust key. Every thay product renders the
  // canonical avatar URL with ?v={avatarVersion}; the moment the avatar
  // changes on thaypley.com OR auth.thaypley.com this number bumps and
  // every connected app picks up the new photo on its next profile
  // fetch — no forced re-auth, no stale CDN copy in their UI.
  const users = app.findCollectionByNameOrId('users');
  users.fields.add(new NumberField({ name: 'avatarVersion', required: false, min: 0, max: 999999 }));
  app.save(users);

  // ── user_apps.syncUrl ───────────────────────────────────────────
  // Optional endpoint an app registers when it pairs, so thay-auth can
  // PUSH avatar-change webhooks to it (instant cache invalidation)
  // instead of waiting for the next profile poll.
  const userApps = app.findCollectionByNameOrId('user_apps');
  userApps.fields.add(new TextField({ name: 'syncUrl', required: false, max: 500 }));
  app.save(userApps);

  // ── catalog_apps: launch roster ─────────────────────────────────
  // All thaypley downloads: desktop apps (tunes, jot, chronometer),
  // CLI (Dabba CLI), desktop (Dabba desktop), cloud (dabba-cloud) and
  // the rest of the platform family. Seed preserves any existing rows
  // by slug (a row already present is only touched if missing fields).
  const catalog = app.findCollectionByNameOrId('catalog_apps');
  catalog.fields.add(new TextField({ name: 'kind', required: false, max: 30 }));
  app.save(catalog);
  const rows = [
    {
      slug: 'tunes',
      displayName: 'thay(tunes)',
      tagline: 'tunes — thaypley music',
      description: 'The thaypley music desktop app — stream, curate, and share your sound across the whole ecosystem. Auth via thay-auth.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://tunes.thaypley.com' },
      sortOrder: 1,
      published: true,
    },
    {
      slug: 'jot',
      displayName: 'thay(jot)',
      tagline: 'Capture the spark before it fades.',
      description: 'A free quick-capture notes app from thaypley — jot ideas, lyrics, and sketches on the fly. Desktop + web.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://jot.thaypley.com' },
      sortOrder: 2,
      published: true,
    },
    {
      slug: 'chronometer',
      displayName: '(chronometer)',
      tagline: 'Time, kept the thaypley way.',
      description: 'A free desktop utility from thaypley — precise time tracking and cosmic scheduling for creators.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://chronometer.thaypley.com' },
      sortOrder: 3,
      published: true,
    },
    {
      slug: 'dabba-cli',
      displayName: 'Dabba CLI',
      tagline: 'The thaypley command line.',
      description: 'Manage your thay-auth identity, pair devices, mint invites (architects), and drive every thaypley platform from the terminal.',
      isFree: true,
      price: 'Free',
      version: '0.1.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/dabba' },
      sortOrder: 4,
      published: true,
    },
    {
      slug: 'dabba-desktop',
      displayName: 'Dabba desktop',
      tagline: 'The thaypley control room.',
      description: 'Desktop companion for the Dabba ecosystem — device management, sync status, and every thay app in one place.',
      isFree: true,
      price: 'Free',
      version: '0.1.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://thaypley.com/dabba' },
      sortOrder: 5,
      published: true,
    },
    {
      slug: 'dabba-cloud',
      displayName: 'dabba-cloud',
      tagline: 'Your thaypley cloud, everywhere.',
      description: 'Cloud sync + storage for the Dabba ecosystem — your data rides with your thay-auth identity across every device.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://cloud.thaypley.com' },
      sortOrder: 6,
      published: true,
    },
    {
      slug: 'fam',
      displayName: 'thay(fam)',
      tagline: 'The family side of thaypley.',
      description: 'Private family & inner-circle space — photos, moments, and updates for the people closest to you.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://fam.thaypley.com' },
      sortOrder: 7,
      published: true,
    },
    {
      slug: 'werk',
      displayName: 'thay(werk)',
      tagline: 'Work, the thaypley way.',
      description: 'Studio operations, projects, and collaboration for creators and their teams.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://werk.thaypley.com' },
      sortOrder: 8,
      published: true,
    },
    {
      slug: 'du',
      displayName: 'thay(du)',
      tagline: 'Du — together, the shared space.',
      description: 'The shared thaypley space — plans, collections, and moments built together.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://du.thaypley.com' },
      sortOrder: 9,
      published: true,
    },
    {
      slug: 'studio',
      displayName: 'thay(studio)',
      tagline: 'Create, capture, produce.',
      description: 'The creator studio desktop app — audio, video, and beats produced inside the thaypley ecosystem.',
      isFree: false,
      price: 'Creator',
      version: '1.0.0',
      downloads: { mac: '', windows: '', linux: '', web: 'https://studio.thaypley.com' },
      sortOrder: 10,
      published: true,
    },
    {
      slug: 'savant',
      displayName: 'thay(savant)',
      tagline: 'The knowledge side of thaypley.',
      description: 'Store, connect, and surface your knowledge across the ecosystem.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://savant.thaypley.com' },
      sortOrder: 11,
      published: true,
    },
    {
      slug: 'tv',
      displayName: 'thay(tv)',
      tagline: 'The screen side of thaypley.',
      description: 'Watch, share, and stream within the thaypley family.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://tv.thaypley.com' },
      sortOrder: 12,
      published: true,
    },
    {
      slug: 'universe',
      displayName: 'thay(universe)',
      tagline: 'Every thay world in one place.',
      description: 'The thaypley universe browser — all platforms, all worlds, one thay-auth identity.',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: { web: 'https://universe.thaypley.com' },
      sortOrder: 13,
      published: true,
    },
    {
      slug: 'homebase',
      displayName: 'thay(portal)',
      tagline: 'Your creator home base.',
      description: 'The portal — dashboards, apps, devices, and your thay-auth profile in one place. You are here.',
      isFree: true,
      price: 'Free',
      version: '2.0.0',
      downloads: { web: 'https://auth.thaypley.com' },
      sortOrder: 14,
      published: true,
    },
  ];

  for (const row of rows) {
    if (!row.kind) {
      if (row.slug.includes('cli')) row.kind = 'cli';
      else if (row.slug.includes('cloud')) row.kind = 'cloud';
      // Key-presence, not truthiness: the roster ships empty download
      // strings ("mac": "") as placeholders, which are falsy — a
      // key-presence check correctly classifies 010-seeded rows and
      // unreleased desktop apps (tunes, chronometer, dabba) as desktop.
      else if (row.downloads && typeof row.downloads === 'object' && ('mac' in row.downloads || 'windows' in row.downloads || 'linux' in row.downloads)) row.kind = 'desktop';
      else row.kind = 'web';
    }
    // Reserve objects only when empty — we DO want to replace the empty
    // downloads map on legacy rows (010 seeded jot/chronometer with {}),
    // even though null/'' gap-fill would leave them untouched.
    const existing = app.findRecordsByExpr('catalog_apps', ['slug', '=', row.slug]);
    if (existing.length > 0) {
      // Row exists (e.g. jot/chronometer from 010) — fill gaps + make
      // sortOrder canonical (010 seeded 1/2; the roster owns the order).
      const rec = existing[0];
      let changed = false;
      for (const [key, value] of Object.entries(row)) {
        if (key === 'slug') continue;
        const current = rec.get(key);
        const isEmptyObj = key === 'downloads' && typeof current === 'object' && current !== null && Object.keys(current).length === 0;
        if (key === 'sortOrder' || current === null || current === undefined || current === '' || isEmptyObj) {
          rec.set(key, value);
          changed = true;
        }
      }
      if (changed) app.save(rec);
      continue;
    }
    const record = new Record(catalog);
    for (const [key, value] of Object.entries(row)) {
      record.set(key, value);
    }
    app.save(record);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('avatarVersion');
  app.save(users);

  const userApps = app.findCollectionByNameOrId('user_apps');
  userApps.fields.removeByName('syncUrl');
  app.save(userApps);

  const catalog = app.findCollectionByNameOrId('catalog_apps');
  catalog.fields.removeByName('kind');
  app.save(catalog);
});
