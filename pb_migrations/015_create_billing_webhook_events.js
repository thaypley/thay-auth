// Stripe webhook idempotency ledger: one row per processed event id.
// Duplicate deliveries (Stripe retries aggressively) are skipped by the
// unique index instead of re-applying entitlement mutations.
migrate((app) => {
  const collection = new Collection({
    name: 'billing_webhook_events',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'eventId', type: 'text', required: true, max: 255 },
      { name: 'eventType', type: 'text', required: false, max: 120 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_billing_webhook_events_event ON billing_webhook_events (eventId)',
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('billing_webhook_events');
  app.delete(collection);
});
