migrate((app) => {
  // Public app catalog — distinct from `user_apps` (which tracks what a
  // given user has installed). This collection is the source list shown
  // in thay(portal)'s downloads section. Read-only to the public; writes
  // go through the admin API / seed script only.
  const collection = new Collection({
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
      {
        name: 'downloads',
        type: 'json',
        required: false,
        maxSize: 5000,
      }, // { mac: url, windows: url, linux: url, web: url }
      { name: 'sortOrder', type: 'number', required: false },
      { name: 'published', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_catalog_apps_slug ON catalog_apps (slug)',
    ],
  });
  app.save(collection);

  // Seed the two initial free launch apps.
  const now = new Date().toISOString();
  const seedRows = [
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

  for (const row of seedRows) {
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
    app.save(record);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('catalog_apps');
  app.delete(collection);
});
