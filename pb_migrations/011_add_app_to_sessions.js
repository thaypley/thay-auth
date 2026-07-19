migrate((app) => {
  const collection = app.findCollectionByNameOrId('sessions');

  // Step 1 of ARCHITECTURE_TOKEN_SCOPING.md: record which thaypley app a
  // session was issued for, so /sessions can eventually be revoked
  // per-app instead of all-or-nothing. Not enforced yet — see doc.
  collection.fields.add(new SelectField({
    name: 'app',
    required: false,
    maxSelect: 1,
    values: ['homebase', 'tunes', 'tv', 'studio', 'savant', 'universe', 'portfolio'],
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('sessions');
  collection.fields.removeByName('app');
  app.save(collection);
});
