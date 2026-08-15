// Membership: base paywall ($5/mo thaypley.com) + à-la-carte app add-ons.
// One row per (userId, target): kind='base' (appKey empty) or kind='app'.
//
// Named membership_subscriptions — the shared PocketBase already has a
// `subscriptions` collection (creator-fan subscriptions, handled by
// thaypley-api/src/routes/subscriptions.js); these must never collide.
//
// Schema-mirrored with the dotcom's
// pb_migrations/1788000001_create_membership_subscriptions.js (prod runs
// the dotcom's copy; this one serves thay-auth's local dev PB).
migrate((app) => {
  const existing = (() => {
    try { return app.findCollectionByNameOrId('membership_subscriptions'); } catch { return null; }
  })();
  if (existing) { console.log('membership_subscriptions already exists, skipping'); return; }

  const collection = new Collection({
    "id": "pbc_membership_subscriptions",
    "name": "membership_subscriptions",
    "type": "base",
    "system": false,
    // Owner-read only. All writes are service-side (thay-auth routes,
    // thaypley-api membership routes, Stripe webhooks) via admin clients.
    "listRule":   "@request.auth.id = userId || @request.auth.role = 'admin'",
    "viewRule":   "@request.auth.id = userId || @request.auth.role = 'admin'",
    "createRule": "@request.auth.role = 'admin'",
    "updateRule": "@request.auth.role = 'admin'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      { "type": "text",   "id": "text_ms_userId",   "name": "userId",     "required": true, "min": 1, "max": 50 },
      { "type": "select", "id": "sel_ms_kind",      "name": "kind",       "required": true, "maxSelect": 1, "values": ["base", "app"] },
      { "type": "text",   "id": "text_ms_appKey",   "name": "appKey",     "required": false, "min": 0, "max": 100 },
      { "type": "select", "id": "sel_ms_status",    "name": "status",     "required": true, "maxSelect": 1, "values": ["trialing", "active", "past_due", "canceled", "incomplete"] },
      { "type": "date",   "id": "date_ms_trialEnd", "name": "trialEnd",   "required": false },
      { "type": "date",   "id": "date_ms_periodEnd","name": "currentPeriodEnd", "required": false },
      { "type": "text",   "id": "text_ms_customer", "name": "stripeCustomerId", "required": false, "min": 0, "max": 255 },
      { "type": "text",   "id": "text_ms_sub",      "name": "stripeSubscriptionId", "required": false, "min": 0, "max": 255 },
      { "type": "autodate", "id": "autodate_ms_created", "name": "created", "onCreate": true, "onUpdate": false },
      { "type": "autodate", "id": "autodate_ms_updated", "name": "updated", "onCreate": true, "onUpdate": true }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_ms_user_target` ON `membership_subscriptions` (`userId`, `kind`, `appKey`)",
      "CREATE INDEX `idx_ms_stripe_sub` ON `membership_subscriptions` (`stripeSubscriptionId`)"
    ]
  });

  try {
    return app.save(collection);
  } catch (e) {
    if (e.message && e.message.includes("Collection name must be unique")) {
      console.log("membership_subscriptions already exists, skipping");
      return;
    }
    throw e;
  }
}, (app) => {
  try {
    const col = app.findCollectionByNameOrId("pbc_membership_subscriptions");
    return app.delete(col);
  } catch (e) {
    console.log("membership_subscriptions not found, skipping revert");
  }
});
