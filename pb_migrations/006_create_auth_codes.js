migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const collection = new Collection({
    name: 'auth_codes',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'userId', type: 'relation', required: true, maxSelect: 1, collectionId: usersCollection.id },
      { name: 'code', type: 'text', required: true, max: 64 },
      { name: 'type', type: 'select', required: true, values: ['email_verification', 'password_reset', 'email_change'], maxSelect: 1 },
      { name: 'expiresAt', type: 'date', required: true },
      { name: 'used', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE INDEX idx_auth_codes_user ON auth_codes (userId)',
      'CREATE INDEX idx_auth_codes_code ON auth_codes (code)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('auth_codes');
  app.delete(collection);
});
