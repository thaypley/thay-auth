// 017_create_account_links.js
// Soul-to-persona chain linking. thay-auth is the single source of truth for identity.
// A soul (primary) account can chain-link persona/business accounts under it.
// API (thay-auth): GET/POST /auth/links, POST /auth/links/:id/accept|decline, DELETE /auth/links/:id.
migrate((app) => {
  const collection = new Collection({
    name: 'account_links',
    type: 'base',
    listRule: '(@request.auth.id = soulId) || (@request.auth.id = linkedId)',
    viewRule: '(@request.auth.id = soulId) || (@request.auth.id = linkedId)',
    createRule: '@request.auth.id != null',
    updateRule: '(@request.auth.id = soulId) || (@request.auth.id = linkedId)',
    deleteRule: '(@request.auth.id = soulId) || (@request.auth.id = linkedId)',
    fields: [
      { name: 'soulId', type: 'text', required: true },
      { name: 'linkedId', type: 'text', required: true },
      { name: 'relation', type: 'select', required: true, maxSelect: 1, values: ['business', 'artist_persona', 'label', 'studio', 'fan_persona', 'other'] },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'linked', 'unlinked'] },
      { name: 'createdBy', type: 'text', required: false },
      { name: 'note', type: 'text', required: false, max: 500 }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_account_links_soul ON account_links (soulId)',
      'CREATE UNIQUE INDEX idx_account_links_linked ON account_links (linkedId)',
      'CREATE INDEX idx_account_links_soul_status ON account_links (soulId, status)',
      'CREATE INDEX idx_account_links_linked_status ON account_links (linkedId, status)'
    ]
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('account_links');
  app.delete(collection);
});
