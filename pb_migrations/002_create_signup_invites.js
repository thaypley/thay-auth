migrate((app) => {
  const collection = new Collection({
    name: 'signup_invites',
    type: 'base',
    listRule: '@request.auth.isArchitect = true',
    viewRule: '@request.auth.isArchitect = true',
    createRule: '@request.auth.isArchitect = true',
    updateRule: '@request.auth.isArchitect = true',
    deleteRule: '@request.auth.isArchitect = true',
    fields: [
      { name: 'code', type: 'text', required: true, unique: true },
      { name: 'used', type: 'bool', required: false },
      { name: 'usedBy', type: 'text', required: false },
      { name: 'usedAt', type: 'date', required: false },
      { name: 'createdBy', type: 'text', required: false },
      { name: 'note', type: 'text', required: false, max: 500 },
      { name: 'maxUses', type: 'number', required: true, min: 1 },
      { name: 'useCount', type: 'number', required: false },
      { name: 'expiresAt', type: 'date', required: false },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_invites_code ON signup_invites (code)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('signup_invites');
  app.delete(collection);
});
