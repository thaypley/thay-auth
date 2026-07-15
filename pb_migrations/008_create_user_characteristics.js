migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const collection = new Collection({
    name: 'user_characteristics',
    type: 'base',
    listRule: 'userId = @request.auth.id || visibility = "public"',
    viewRule: 'userId = @request.auth.id || visibility = "public"',
    createRule: 'userId = @request.auth.id',
    updateRule: 'userId = @request.auth.id',
    deleteRule: 'userId = @request.auth.id',
    fields: [
      {
        name: 'userId',
        type: 'relation',
        required: true,
        maxSelect: 1,
        collectionId: usersCollection.id,
        cascadeDelete: true,
      },
      { name: 'key', type: 'text', required: true, max: 100 },
      { name: 'value', type: 'text', required: true, max: 2000 },
      {
        name: 'visibility',
        type: 'select',
        required: true,
        maxSelect: 1,
        values: ['public', 'private', 'connections'],
      },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_user_chars_user_key ON user_characteristics (userId, key)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('user_characteristics');
  app.delete(collection);
});