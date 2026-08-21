/// <reference path="../pb_data/types.d.ts" />

/**
 * guard_reserved_names.pb.js
 *
 * UaZit lockdown (2026): permanently reserves the identities
 * @x @grok @grokbot @xmoney @spacex @spacexai @starlink @elon @elonmusk and
 * @thewhitehouse @donaldtrump @trump @unitedstatesofamerica @usa
 * @unitedstates @america across EVERY thay platform. No non-superuser may create or rename a users
 * record into one of these identities, through ANY surface — PocketBase
 * SDK, REST, thay-auth, or a future app we haven't written yet.
 *
 * This is layer 2 of the defense (layer 1 is thay-auth's
 * src/utils/guardedNames.ts on the API routes). This hook catches
 * direct-to-PocketBase writes that bypass thay-auth entirely.
 *
 * GATED APPROVAL: only a superuser (UaZit via the PB admin UI / admin
 * API) may create or approve such an account. Approval is recorded by
 * setting `guardApproved = true` on the users record. Records carrying
 * that flag are exempt from the block.
 *
 * DEPLOY (PocketBase only loads hooks from its own pb_hooks/ dir):
 *   scp pb_hooks/guard_reserved_names.pb.js \
 *     thaypley-vps:/home/thaypley/pocketbase/pb_hooks/
 *   ssh thaypley-vps "cd /home/thaypley/pocketbase && ./pocketbase --dev"
 * PB hot-reloads hooks on change; restart anyway after a prod deploy.
 */

var GUARDED_NAMES = [
  // ── tech/identity lockdown (2026) ──
  'x',
  'grok',
  'grokbot',
  'xmoney',
  'spacex',
  'spacexai',
  'starlink',
  'elon',
  'elonmusk',
  // ── government/nation-state lockdown ──
  'thewhitehouse',
  'donaldtrump',
  'trump',
  'unitedstatesofamerica',
  'usa',
  'unitedstates',
  'america',
];

var GUARD_NOTICE =
  'AUTHENTICATION NOTICE: this identity is permanently reserved on thaypley. ' +
  'To request gated approval, email uazit@thaypley.com directly from the account owner. ' +
  'Any attempt to register it is logged.';

// Normalize: lowercase, strip leading @, drop separators so "@Elon",
// "elon_musk", "X_", and "grok.bot" all resolve to canonical form.
function normalizeGuardedName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function isGuardedName(raw) {
  var n = normalizeGuardedName(raw);
  if (!n) return false;
  return GUARDED_NAMES.indexOf(n) !== -1;
}

function isGuardedEmail(email) {
  if (typeof email !== 'string' || email.indexOf('@') === -1) return false;
  return isGuardedName(email.slice(0, email.indexOf('@')));
}

function violatesGuard(record) {
  if (!record) return false;
  // Explicit gated approval from UaZit exempts the record.
  if (record.get('guardApproved') === true) return false;
  return isGuardedName(record.get('username')) || isGuardedEmail(record.get('email'));
}

// ── Block signup/creation attempts ──────────────────────────────────
onRecordCreateRequest((e) => {
  if (e.collection.name === 'users' && !e.hasSuperuserAuth() && violatesGuard(e.record)) {
    console.warn('[guard] blocked guarded-name CREATE attempt', {
      username: e.record.get('username'),
      ip: e.realIP ? e.realIP() : '',
    });
    throw new BadRequestError(GUARD_NOTICE);
  }
  e.next();
}, 'users');

// ── Block renaming INTO a guarded name (and un-approving then keeping one) ──
onRecordUpdateRequest((e) => {
  if (e.collection.name === 'users' && !e.hasSuperuserAuth()) {
    var original = e.record.original ? e.record.original() : null;
    var wasAllowed = original ? !violatesGuard(original) : true;
    var nowViolates = violatesGuard(e.record);
    // Block if the save would introduce a guarded identity that wasn't
    // already legitimately there (i.e. someone renaming into it).
    if (nowViolates && wasAllowed) {
      console.warn('[guard] blocked guarded-name UPDATE attempt', {
        id: e.record.get('id'),
        username: e.record.get('username'),
        ip: e.realIP ? e.realIP() : '',
      });
      throw new BadRequestError(GUARD_NOTICE);
    }
  }
  e.next();
}, 'users');
