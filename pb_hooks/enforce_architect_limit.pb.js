/// <reference path="../pb_data/types.d.ts" />

/**
 * enforce_architect_limit.pb.js
 *
 * Blocks non-superuser writes to privileged fields on the `users`
 * collection: isArchitect, isVerified, tier, emailVerificationCode,
 * emailVerificationCodeExpiry.
 *
 * WHY THIS EXISTS (see PREMORTEM.md #9, 2026-07-17 audit):
 * thay-auth hands every logged-in user a real PocketBase auth token for
 * the shared `users` collection. If that collection's updateRule is only
 * `id = @request.auth.id` (row-level, PocketBase has no field-level API
 * rules), any authenticated user can PATCH their own record directly
 * against PocketBase — bypassing thay-auth's routes entirely — and set
 * isArchitect=true / tier="creator" / isVerified=true to grant themselves
 * admin status or skip email verification. A hook is the only mechanism
 * PocketBase gives us to enforce field-level protection.
 *
 * This file was previously believed to exist only on the VPS filesystem
 * (/home/thaypley/pocketbase/pb_hooks/), unversioned — see TODO.md
 * 2026-07-14/15 entries where it was accidentally moved to
 * pb_hooks_disabled/ and had to be restored from memory. This copy in
 * the repo is the source of truth going forward. If the VPS's live copy
 * differs from this one, diff them and reconcile — this file wins.
 *
 * DEPLOY: PocketBase only loads hooks from its own `pb_hooks/` directory
 * next to the running binary — it does NOT read this repo's pb_hooks/ at
 * runtime (thay-auth's Node process and the PocketBase Go process are
 * separate). To activate:
 *   scp pb_hooks/enforce_architect_limit.pb.js \
 *     thaypley-vps:/home/thaypley/pocketbase/pb_hooks/
 *   ssh thaypley-vps "cd /home/thaypley/pocketbase && ./pocketbase --dev" # restart normally in prod, --dev only to watch logs once
 * PocketBase hot-reloads pb_hooks/*.pb.js on change — no restart strictly
 * required, but restart anyway to be sure after a prod deploy.
 */

const PROTECTED_FIELDS = [
  'isArchitect',
  'isVerified',
  'tier',
  'emailVerificationCode',
  'emailVerificationCodeExpiry',
];

onRecordUpdateRequest((e) => {
  // Superuser (admin API) requests — thay-auth's own admin-authenticated
  // PocketBase client, or a human in the PB admin UI — are always allowed
  // through. Everything else is a request made with an end-user's own
  // auth token and must not touch protected fields.
  const isSuperuserRequest = e.hasSuperuserAuth && e.hasSuperuserAuth();

  if (!isSuperuserRequest) {
    for (const field of PROTECTED_FIELDS) {
      // e.record holds the record as it will be saved; compare against
      // the original to detect an attempted change rather than trusting
      // the request body directly (some PB versions merge server-side
      // defaults into e.record before this hook runs).
      const original = e.record.original ? e.record.original().get(field) : e.record.get(field);
      const incoming = e.record.get(field);
      if (JSON.stringify(original) !== JSON.stringify(incoming)) {
        throw new BadRequestError(
          `Field "${field}" cannot be changed via self-service update.`,
        );
      }
    }
  }

  e.next();
}, 'users');
