migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users');
  const collection = new Collection({
    name: 'user_apps',
    type: 'base',
    listRule: 'userId = @request.auth.id',
    viewRule: 'userId = @request.auth.id',
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
      { name: 'appId', type: 'text', required: true, max: 100 },
      { name: 'appName', type: 'text', required: false, max: 200 },
      { name: 'installedVersion', type: 'text', required: false, max: 50 },
      { name: 'latestVersion', type: 'text', required: false, max: 50 },
      { name: 'autoUpdate', type: 'bool', required: false },
      { name: 'installedAt', type: 'date', required: false },
      { name: 'lastUpdatedAt', type: 'date', required: false },
      { name: 'status', type: 'select', required: false, maxSelect: 1, values: ['installed', 'updating', 'update_available', 'error', 'uninstalled'] },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_user_apps_user_app ON user_apps (userId, appId)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('user_apps');
  app.delete(collection);
});