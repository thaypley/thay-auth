migrate((app) => {
  const collection = app.findCollectionByNameOrId('catalog_apps');

  // Family groups: core (portal apps), dabba (assistant ecosystem),
  // tabbi (cognitive OS), creative (studio suite).
  collection.fields.add(new TextField({
    name: 'family',
    required: false,
    max: 40,
  }));
  app.save(collection);

  // Classify existing rows by slug.
  const familyBySlug = {
    'thaypley-tunes': 'core',
    'thaypley-tv': 'core',
    'jot': 'core',
    'thay-jot': 'core',
    'chronometer': 'core',
    'dabba-desktop': 'dabba',
    'dabba-cli': 'dabba',
    'dabba-cloud': 'dabba',
    'thaypley-studio': 'creative',
  };

  const existing = app.findRecordsByFilter('catalog_apps', '', '', 0, 0);
  for (const rec of existing) {
    const slug = rec.getString('slug');
    const family = familyBySlug[slug] || 'core';
    if (rec.getString('family') !== family) {
      rec.set('family', family);
      app.save(rec);
    }
  }

  // Seed the new apps — 12 rows spanning core, dabba, tabbi and creative.
  const existingSlugs = new Set(existing.map((r) => r.getString('slug')));
  const seedRows = [
    {
      slug: 'thay-locker',
      displayName: 'thay(locker)',
      tagline: 'your encrypted vault for everything',
      description: 'passwords, keys, files, and secrets — locked tight and syncable across devices.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '1.0.0',
      downloads: {},
      sortOrder: 4,
      published: true,
      family: 'core',
    },
    {
      slug: 'slashcat',
      displayName: '(slashcat) browser',
      tagline: 'a browser that thinks with you',
      description: 'the creator browser — command-first navigation, tab groups, and AI-assisted browsing built in.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.9.0',
      downloads: {},
      sortOrder: 5,
      published: true,
      family: 'core',
    },
    {
      slug: 'dabba-root',
      displayName: '(dabba) — root',
      tagline: 'the core assistant kernel',
      description: 'the root daemon that powers every dabba skill — local, private, always on.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.6.2',
      downloads: {},
      sortOrder: 11,
      published: true,
      family: 'dabba',
    },
    {
      slug: 'gab',
      displayName: '(gab)-skills',
      tagline: 'skills for your assistant',
      description: 'the (gab) skills marketplace — install personality, workflow, and automation skills into dabba.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.4.0',
      downloads: {},
      sortOrder: 12,
      published: true,
      family: 'dabba',
    },
    {
      slug: 'tabbi',
      displayName: 'tabbi(COS)',
      tagline: 'the cognitive operating system',
      description: 'an operating layer for thought — capture, structure, and retrieve everything your mind touches.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.5.0',
      downloads: {},
      sortOrder: 21,
      published: true,
      family: 'tabbi',
    },
    {
      slug: 'webiverse',
      displayName: '(webiverse)',
      tagline: 'personal context infrastructure',
      description: 'your context graph — every note, link, and memory woven into one navigable universe.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.5.0',
      downloads: {},
      sortOrder: 22,
      published: true,
      family: 'tabbi',
    },
    {
      slug: 'webispectral',
      displayName: '(webispectral)',
      tagline: 'protocol for minds, connected',
      description: 'the protocol layer — standard schemas and handshakes for sharing context between apps and agents.',
      iconUrl: '',
      isFree: true,
      price: 'Free',
      version: '0.2.0',
      downloads: {},
      sortOrder: 23,
      published: true,
      family: 'tabbi',
    },
    {
      slug: 'thay-design',
      displayName: '(design)',
      tagline: 'graphic design, reimagined',
      description: 'vector, layout, and brand tools in one fluid canvas — made for creators who ship.',
      iconUrl: '',
      isFree: false,
      price: '$8/mo',
      version: '0.3.0',
      downloads: {},
      sortOrder: 31,
      published: true,
      family: 'creative',
    },
    {
      slug: 'ls-photo',
      displayName: '(ls)photo',
      tagline: 'photo editing, light-speed',
      description: 'non-destructive RAW editing, layers, and film-grade color in a blazing-fast editor.',
      iconUrl: '',
      isFree: false,
      price: '$8/mo',
      version: '0.3.0',
      downloads: {},
      sortOrder: 32,
      published: true,
      family: 'creative',
    },
    {
      slug: 'ls-video',
      displayName: '(ls)video',
      tagline: 'video editing, light-speed',
      description: 'timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.',
      iconUrl: '',
      isFree: false,
      price: '$10/mo',
      version: '0.3.0',
      downloads: {},
      sortOrder: 33,
      published: true,
      family: 'creative',
    },
    {
      slug: 'ls-effect',
      displayName: '(ls)effect',
      tagline: 'motion graphics & effects',
      description: 'compositing, particles, and typography in motion — the VFX surface for the thay universe.',
      iconUrl: '',
      isFree: false,
      price: '$10/mo',
      version: '0.2.0',
      downloads: {},
      sortOrder: 34,
      published: true,
      family: 'creative',
    },
    {
      slug: 'thay-pattern',
      displayName: '(pattern)',
      tagline: 'fashion design studio',
      description: 'pattern drafting, textile simulation, and runway-ready presentation in one studio.',
      iconUrl: '',
      isFree: false,
      price: '$8/mo',
      version: '0.1.0',
      downloads: {},
      sortOrder: 35,
      published: true,
      family: 'creative',
    },
  ];

  for (const row of seedRows) {
    if (existingSlugs.has(row.slug)) {
      // Idempotent: update the row instead of duplicating it.
      const matches = app.findRecordsByFilter('catalog_apps', 'slug=' + JSON.stringify(row.slug), '', 1, 0);
      if (matches.length > 0) {
        const rec = matches[0];
        rec.set('displayName', row.displayName);
        rec.set('tagline', row.tagline);
        rec.set('description', row.description);
        rec.set('isFree', row.isFree);
        rec.set('price', row.price);
        rec.set('version', row.version);
        rec.set('downloads', row.downloads);
        rec.set('sortOrder', row.sortOrder);
        rec.set('published', row.published);
        rec.set('family', row.family);
        app.save(rec);
      }
    } else {
      const record = new Record(collection);
      record.set('slug', row.slug);
      record.set('displayName', row.displayName);
      record.set('tagline', row.tagline);
      record.set('description', row.description);
      record.set('iconUrl', row.iconUrl);
      record.set('isFree', row.isFree);
      record.set('price', row.price);
      record.set('version', row.version);
      record.set('downloads', row.downloads);
      record.set('sortOrder', row.sortOrder);
      record.set('published', row.published);
      record.set('family', row.family);
      app.save(record);
    }
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('catalog_apps');
  const rowsToDelete = ['thay-locker', 'slashcat', 'dabba-root', 'gab', 'tabbi', 'webiverse', 'webispectral', 'thay-design', 'ls-photo', 'ls-video', 'ls-effect', 'thay-pattern'];
  const existing = app.findRecordsByFilter('catalog_apps', '', '', 0, 0);
  for (const rec of existing) {
    if (rowsToDelete.includes(rec.getString('slug'))) {
      app.delete(rec);
    }
  }
  collection.fields.removeByName('family');
  app.save(collection);
});
