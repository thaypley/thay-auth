migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const collection = new Collection({
    name: 'email_change_requests',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'userId', type: 'relation', required: true, maxSelect: 1, collectionId: usersCollection.id },
      { name: 'token', type: 'text', required: true, max: 64 },
      { name: 'oldEmail', type: 'email', required: true },
      { name: 'newEmail', type: 'email', required: true },
      { name: 'expiresAt', type: 'date', required: true },
      { name: 'used', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_email_change_token ON email_change_requests (token)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('email_change_requests');
  app.delete(collection);
});
