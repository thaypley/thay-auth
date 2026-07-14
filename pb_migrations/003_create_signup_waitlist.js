migrate((app) => {
  const collection = new Collection({
    name: 'signup_waitlist',
    type: 'base',
    listRule: '@request.auth.isArchitect = true',
    viewRule: '@request.auth.isArchitect = true',
    createRule: '',
    updateRule: '@request.auth.isArchitect = true',
    deleteRule: '@request.auth.isArchitect = true',
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'note', type: 'text', required: false, max: 500 },
      { name: 'source', type: 'text', required: false },
      { name: 'invitedAt', type: 'date', required: false },
      { name: 'inviteId', type: 'text', required: false },
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('signup_waitlist');
  app.delete(collection);
});
