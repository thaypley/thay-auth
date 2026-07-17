# thay-auth Premortem — 2026-07-17, pre-launch audit

Imagine it's the morning after test launch and something embarrassing or dangerous happened. This is the list of "what broke" written in advance, ranked by how likely it was to actually happen, with what was fixed tonight vs. what's still open.

## Fixed tonight

**1. JWT secret could silently fall back to a public default.** `config.ts` used to do `process.env.THAY_AUTH_JWT_SECRET || 'dev-secret-change-in-production'`. If the env var was ever missing (typo, `.env` not loaded, bad deploy), the service would boot fine and sign every device token with a string anyone can read in this repo's git history — full auth forgery. Now the service refuses to boot without a real secret (≥16 chars). Confirmed the live `.env` already has a proper 40-char secret, so this doesn't break the current deploy.

**2. No rate limiting anywhere.** Login, signup, email verification, password reset, username checks — none of it was throttled. A 6-digit email verification code (1M possibilities, 15-minute window) was brute-forceable with concurrent requests. Added a lightweight in-memory limiter (`src/utils/rateLimit.ts`, no new dependency) and applied it to every auth-adjacent route. `app.set('trust proxy', 1)` added so it reads the real client IP behind nginx.

**3. Weak randomness on security-relevant tokens.** Device pairing tokens and email verification codes used `Math.random()`, which is not cryptographically secure. Switched both to `crypto.randomBytes`/`crypto.randomInt`.

**4. PocketBase filter-injection risk.** Several routes interpolated client-supplied strings straight into PB filter query strings (e.g. `appId` in `/auth/apps`). Added an escaping helper and applied it wherever the value wasn't already constrained by a strict regex.

**5. Password reset flow was half-built.** `/auth/request-password-reset` existed but there was no way to actually complete a reset — no `/auth/confirm-password-reset` route, no SDK method, and no "forgot password" link anywhere in the UI. This would have been the first thing to visibly break for a real user. Added the completion endpoint, SDK method, and two new pages (`ForgotPasswordPage`, `ResetPasswordPage`) wired into the login screen.

**6. Waitlist form was a dead button.** `WaitlistPage.js` called `auth.joinWaitlist(...)`, which didn't exist on the SDK — the backend route worked, the frontend wrapper was just never written. Since signup is gated behind a mandatory invite code, this meant uninvited visitors had *no* way in at all. Fixed.

**7. Brand fonts declared but never loaded.** `--font-body` (DM Sans) and `--font-mono` (Space Mono) were referenced throughout the CSS but nothing ever `<link>`'d them in — silent fallback to system fonts on every page. Added the Google Fonts link in `index.html`.

**8. Dashboard's app grid had a dead "coming soon" card.** Now links to the new downloads catalog instead.

## Still open — needs a decision, not code

**9. Privilege escalation via direct PocketBase writes.** `auth.ts` hands users a real PocketBase auth token, and `users` has no committed `updateRule` restricting which fields a user can self-edit. If the live `users` collection's default rule allows `id = @request.auth.id` with no field allowlist, any logged-in user could `PATCH` their own `isArchitect`/`tier`/`isVerified` directly against PocketBase and grant themselves admin status. TODO.md confirms a mitigating hook (`enforce_architect_limit.pb.js`) already exists on the VPS — but it lives *only* on the VPS filesystem, not in this repo, so it's unversioned and can silently vanish on the next PB upgrade (this already happened once, per the 07-14 session notes).

**UPDATE 2026-07-17 (later same day):** drafted `pb_hooks/enforce_architect_limit.pb.js` in this repo as the versioned source of truth — blocks non-superuser writes to `isArchitect`, `isVerified`, `tier`, `emailVerificationCode`, `emailVerificationCodeExpiry` on `users`. **Not yet deployed** — PocketBase only reads hooks from its own `pb_hooks/` next to the running binary, not from this repo at runtime, so this still needs `scp` to the VPS + a restart (exact commands in the file's header comment). If the VPS already has a differently-written version of this hook, diff before overwriting — this file is written from scratch based on the audit findings, not copied from the VPS original (I don't have access to read that copy from this sandbox).

**10. No audience/app scoping on tokens.** thay-auth is meant to be the shared login for every thaypley app (tunes, tv, studio, savant, universe, the uncensored portfolio...), but a token issued for one app is valid against all of them — there's no `aud` claim and no per-app revocation. Fine for a single-app test launch tomorrow; becomes a real problem the moment a second app goes live sharing this auth service.

**UPDATE 2026-07-17 (later same day):** design proposal written up in `ARCHITECTURE_TOKEN_SCOPING.md` — `aud` claim + registered app slugs + actually populating the unused `sessions` collection + per-app revocation in `requireUser`. Not implemented; needs review before coding, since it touches every future app integration.

**11. Dual SQLite writers.** With `DIRECT_SQL_USERS=1` (live in prod), thay-auth writes directly into PocketBase's `data.db` while the PB Go process has the same file open. Under a launch traffic spike this is a real corruption risk, and it silently bypasses any PB hooks (including #9's protection) on the signup path specifically. Not touched tonight — this is a structural workaround for a PB admin-API bug that's already tracked in TODO.md as its own project.

**12. `sessions` collection is defined but never populated** — `/sessions` will always return empty. Cosmetic, not dangerous, but will look broken if surfaced in UI.

**13. PocketBase's password-reset email template/URL** needs to be confirmed to actually point at `https://<homebase-domain>/#/reset-password?token=...` (PB's admin settings control this, not this codebase) — otherwise the new confirm-reset flow built tonight has nothing valid to complete against. Worth a 2-minute check in the PB admin UI before relying on it.

## New this session: (chronometer) & thay(jot) downloads

- `pb_migrations/010_create_catalog_apps.js` — new `catalog_apps` collection (public list/view, admin-only writes), seeded with both apps.
- `scripts/seed-catalog-apps.mjs` — idempotent seed script for the **live** PB instance, following the same pattern the codebase already uses for `user_apps`/`user_characteristics` (manual creation via the superuser API, since migrations aren't run directly against `hcgi/platform`). Run this against prod: `node scripts/seed-catalog-apps.mjs`.
- `GET /auth/catalog` — new public route, no auth required.
- Homebase: `getCatalog()` SDK method, new `/downloads` page (public, no login gate — doubles as marketing), nav link, dashboard cross-link.
- Both apps seeded as free (`isFree: true`, `price: "Free"`) with empty `downloads` URLs — **fill in the actual `mac`/`windows`/`linux` build URLs in the `catalog_apps` records once the two apps have real download artifacts.** Until then the buttons render "coming soon" and are disabled.

## Also fixed 2026-07-17 (post-build-check follow-up)

- **`nodemailer` bumped `^6.10.1` → `^9.0.3`.** `npm audit` flagged 8 high-severity advisories (SMTP command injection, CRLF header injection, TLS cert validation gaps, jsonTransport file-access bypass) all fixed by 9.0.3. Checked the actual changelog rather than trusting npm's "breaking change" label: the only breaking changes between those versions are SES SDK removal (v7 — unused here, `email.ts` is plain SMTP) and a renamed error code (v8, `NoAuth`→`ENOAUTH` — never referenced in this codebase). `email.ts`'s usage (`createTransport` + `sendMail` with host/port/auth/from/to/subject/html, no attachments, no OAuth2) is untouched by any of it.
- **`eslint` wired up.** `package.json` had a `"lint": "eslint src"` script but eslint was never added as a dependency — `npm run lint` failed outright. Added `eslint` + `typescript-eslint` as devDependencies and `eslint.config.js` (flat config, ESLint 9). Tuned to catch real bugs (unused vars, floating equality, dead code) without fighting the codebase's existing heavy use of `unknown`/type-assertion casts against PocketBase's loosely-typed records.

## Not touched (out of scope tonight, flagged for awareness)

- Multi-tenancy token scoping (#10)
- PB hook versioning (#9's actual fix)
- Dual-SQLite-writer risk (#11)
- No build/test run was possible in this sandbox (npm registry blocked, `node_modules` read-only) — all TypeScript changes were reviewed manually line-by-line instead of compiled. **Run `npm run build` and `npm run lint` locally before deploying.**
