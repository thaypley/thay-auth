# Token audience/app scoping — design doc

Status: **step 1 implemented 2026-07-17 (later same day).** Written as a follow-up to the pre-launch premortem (`PREMORTEM.md` #10).

## Implementation note (step 1, as actually built)

The `sessions` collection already existed with a `tokenHash` field (used by nothing until now) rather than a session-ID-in-JWT design — so step 1 was simpler than originally sketched below: **no new JWT format needed.** Instead:

- `pb_migrations/011_add_app_to_sessions.js` (+ `scripts/add-app-field-to-sessions.mjs` for the live instance, same "migrations don't run against hcgi/platform directly" pattern as `catalog_apps`) adds a `sessions.app` select field.
- `/auth/login`, `/auth/signup`, `/auth/refresh` now accept an optional `app` body param (defaults to `homebase`, validated against `KNOWN_APPS` in `src/utils/apps.ts`) and write a `sessions` row keyed by `sha256(token)` via the new `recordSession()` helper in `auth.ts`. Non-fatal on failure — never blocks login if the migration hasn't landed on a given PB instance yet.
- `requireUser` (`src/middleware/requireAuth.ts`) now checks for a matching `sessions` row and rejects with 401 if `revoked: true`. **Fails open** if no row exists (pre-rollout tokens, or the migration not yet applied) — this can only make things *stricter* for tokens we recorded, never lock anyone out unexpectedly.
- `GET /sessions` now returns each session's `app`.

**Not yet done:** per-route `aud` enforcement (a token issued for `app: "tunes"` still works against every route — nothing rejects cross-app use yet). That's intentionally deferred to whenever a second app actually integrates, per the original rollout sequence below. Also not done: the homebase SDK doesn't explicitly pass `app: "homebase"` on `signup()` (relies on the server-side default, which is correct today but silent).

**Deploy step required:** run `node scripts/add-app-field-to-sessions.mjs` against prod (same as the catalog seed script) before this does anything live — until then `recordSession` fails silently (by design) and sessions just don't get the `app` label yet.

## Original proposal (pre-implementation)

Status: review before further changes — this touches every app that will ever authenticate through thay-auth.

## The problem

thay-auth is meant to be the single login for every thaypley surface: thaypley.com, thay(tunes), thay(tv), thay(studio), thay(savant), thay(universe), the uncensored portfolio, and whatever else joins later. Today, `POST /auth/login` and `/auth/signup` return PocketBase's own auth token verbatim, with no claim identifying which app requested it. `requireUser` (`src/middleware/requireAuth.ts`) validates the token's signature and expiry only — it has no concept of "issued for app X."

Practically, this means:

- A token obtained in thay(tunes)'s web client is fully valid against thay(studio)'s API calls, thay(savant), and every other consumer — nothing prevents cross-app replay.
- A token leaked from one app (XSS in a low-trust surface, a compromised third-party embed, a careless log line) is a valid credential everywhere, not just where it leaked.
- `/sessions` and `/devices` have no way to say "revoke my thay(tunes) session but keep me logged into thaypley.com" — revocation is all-or-nothing per token.
- There's no per-app audit trail: `GET /auth/me` can't tell you which apps a user is currently authenticated into.

This is a non-issue while thay-auth backs a single app (the test launch). It becomes a real problem the moment a second app goes live against the same auth service, which per the roadmap (thay-tunes-desktop is already queued per TODO.md) is soon.

## Proposed approach

### 1. Registered app identifiers

Introduce a small, hardcoded (to start) registry of known app slugs: `homebase`, `tunes`, `tv`, `studio`, `savant`, `universe`, `portfolio`. Each client declares its app slug when authenticating.

### 2. `aud` claim on issued tokens

thay-auth currently re-exports PocketBase's own token as-is. Two options:

- **(a) Wrap it.** Keep using PB's token for the actual PB-facing auth (needed since `requireUser` calls `pb.collection('users').authRefresh()` under the hood), but also mint a thay-auth-specific JWT (same pattern as `signDeviceToken` in `src/providers/jwt.ts`) carrying `{ sub: userId, aud: appSlug, sessionId }`, and have every app call thay-auth's own `requireUser` middleware (not PB directly) so the `aud` check actually gets enforced.
- **(b) Stop handing out the raw PB token entirely.** thay-auth becomes the only thing that ever talks to PocketBase directly; every app gets a thay-auth-issued JWT and calls thay-auth's own API for anything user-scoped. This is the architecturally cleaner option and closes a separate issue (apps currently *could* bypass thay-auth and hit `hcgi/platform` directly with the token they were given) but is a bigger lift — every app's client code needs to stop constructing a `PocketBase` client from the token.

Recommend **(a)** as the incremental step for the next app onboarding, with **(b)** as the eventual target once there's bandwidth to migrate existing clients.

### 3. Login/signup accept an `app` parameter

```
POST /auth/login
{ "identity": "...", "password": "...", "app": "tunes" }
```

Validate `app` against the registry; reject unknown values. Include it in the minted `aud` claim and in a new `sessions` row (see below — this also fixes PREMORTEM.md #12, the unpopulated `sessions` collection).

### 4. Actually populate `sessions`

Right now `/login` never writes a `sessions` row — only `/devices/pair` does. Wire login (and signup's post-signup auth) to create a `sessions` record: `{ userId, app, createdAt, lastSeenAt, userAgent, revoked }`. This gives `/sessions` something real to list, and gives per-app revocation somewhere to live: `DELETE /sessions/:id` marks that row revoked, and `requireUser` checks the session row (not just JWT validity) before allowing the request through — this is what makes revocation actually work instead of just deleting a UI list item.

### 5. `requireUser` enforces `aud` + session state

New middleware check order: verify JWT signature/expiry (existing) → confirm `aud` matches the app the route belongs to (new; each app's deployment of thay-auth-consuming code know their own slug) → look up the `sessions` row referenced by the token's `sessionId` and confirm `revoked !== true` (new).

## What this does NOT change

- The underlying PocketBase `users` collection, its rules, or the privilege-escalation fix in `pb_hooks/enforce_architect_limit.pb.js` — orthogonal concern.
- Device tokens (`src/providers/jwt.ts` `signDeviceToken`) already carry a `type: 'device'` claim and are scoped by `scopes` — they're a reasonable model to copy for the new user-session JWT.
- Nothing about this requires a new database; `sessions` and the app registry can both live in the existing PocketBase instance (`sessions` already exists as a collection per migration 005, just unused).

## Rollout sequence (once approved)

1. Add the app registry + `aud` claim + session-row creation on login/signup. Ship behind a flag so existing single-app (homebase) behavior is unaffected if `app` is omitted (defaults to `homebase`, current behavior — token still works everywhere, just logged/labeled).
2. Update homebase's SDK (`homebase/src/auth-sdk-lib.js`) to pass `app: "homebase"` on login/signup — no functional change yet, just gets the label flowing end to end.
3. When thay-tunes-desktop (or any second app) is actually onboarded, flip `requireUser` to *enforce* `aud` matching for that app's routes, not just record it. Do this per-app as each one integrates, not as a big-bang cutover.
4. Revisit (b) — routing every app off direct PocketBase access — once 2+ apps are live and the pattern has proven out.
