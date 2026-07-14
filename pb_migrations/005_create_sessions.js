migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const devicesCollection = app.findCollectionByNameOrId('devices');
  const collection = new Collection({
    name: 'sessions',
    type: 'base',
    listRule: 'userId = @request.auth.id',
    viewRule: 'userId = @request.auth.id',
    createRule: 'userId = @request.auth.id',
    updateRule: null,
    deleteRule: 'userId = @request.auth.id',
    fields: [
      { name: 'userId', type: 'relation', required: true, maxSelect: 1, collectionId: usersCollection.id },
      { name: 'tokenHash', type: 'text', required: true },
      { name: 'deviceId', type: 'relation', required: false, maxSelect: 1, collectionId: devicesCollection.id },
      { name: 'ip', type: 'text', required: false },
      { name: 'userAgent', type: 'text', required: false, max: 500 },
      { name: 'expiresAt', type: 'date', required: false },
      { name: 'revoked', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE INDEX idx_sessions_user ON sessions (userId)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('sessions');
  app.delete(collection);
});
