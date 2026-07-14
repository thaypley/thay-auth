migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const collection = new Collection({
    name: 'devices',
    type: 'base',
    listRule: 'userId = @request.auth.id',
    viewRule: 'userId = @request.auth.id',
    createRule: 'userId = @request.auth.id',
    updateRule: 'userId = @request.auth.id',
    deleteRule: 'userId = @request.auth.id',
    fields: [
      { name: 'userId', type: 'relation', required: true, maxSelect: 1, collectionId: usersCollection.id },
      { name: 'tokenHash', type: 'text', required: true },
      { name: 'label', type: 'text', required: true, max: 100 },
      { name: 'scopes', type: 'json', required: false },
      { name: 'lastSeenAt', type: 'date', required: false },
      { name: 'expiresAt', type: 'date', required: false },
      { name: 'revoked', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE INDEX idx_devices_user ON devices (userId)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('devices');
  app.delete(collection);
});
