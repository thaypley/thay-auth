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

## UI/UX premortem — homebase frontend, 2026-07-17 (later same night)

The backend/security audit above never looked at the actual `homebase` frontend a real tester touches first. Ran a full audit of every page (`Login`, `Signup`, `Waitlist`, `Verify`, `ForgotPassword`, `ResetPassword`, `Dashboard`, `Profile`, `Downloads`, `NotFound`) against accessibility, error/loading/empty states, mobile layout, and the "(you)"/"(u)" brand-punctuation convention. Imagined a real tester hitting each flow tomorrow and ranked findings by how bad it'd be if they did. ~38 issues found; the 10 critical + 16 medium ones are fixed below. `node --check` passed on every changed file (this sandbox can't run `vite build` — `@rollup/rollup-linux-arm64-gnu` is missing from `node_modules`, a pre-existing environment issue unrelated to tonight's changes — **run `npm run build` in `homebase/` locally before deploying**).

### Fixed tonight

**14. Nearly every secondary link was invisible to keyboard/screen-reader users.** `utils/dom.js`'s `h()` never gave `<a onClick>` elements an `href`, so they weren't in the tab order and weren't exposed as links — "forgot password?", "sign up", "join waitlist", both signup "back" links, "resend code", "log out", the navbar brand/avatar, "back to dashboard", all of it. Converted every one to a real `<button type="button">` (new `.link-btn` class in `components.css`, `navbar-brand`/`navbar-user` in `NavBar.js`) so they're keyboard-operable and correctly announced.

**15. Primary buttons failed WCAG contrast — white text on the pink gradient was ~2.6:1, needs 4.5:1.** Every "log in" / "continue" / "create account" / "verify" / "reset password" button had this. Changed `.btn-primary` text to black (`--black`), which lands at ~6.2:1 on the same gradient. Also fixed `.profile-avatar-placeholder` and navbar avatar-initial fallbacks the same way, and darkened the base link/anchor color into a new `--pink-text` token (~4.8:1) since `--pink-dark` used directly as text failed too.

**16. Password reset was a real dead end.** Missing/expired-token state had no link back anywhere — just a static sentence. Added a "request a new link" button on the missing-token state and a persistent "link expired or not working? request a new one" footer on the form itself. Separately: PocketBase's reset-email URL still needs a 2-minute manual check in the PB admin UI to confirm it actually points at `/#/reset-password?token=...` — can't verify that from this sandbox, and if it's wrong none of tonight's frontend fixes matter because the user never reaches this page at all.

**17. The fixed navbar had no reserved space on auth pages and no mobile breakpoint anywhere.** Tall content (signup step 3's avatar/username/bio/pronouns/astral-sign form) could start behind the navbar; on phones the navbar had no wrap rule so "sign up" could get clipped. Added `padding-top` to `.auth-page` matching what `.dashboard` already did, and a `@media (max-width: 480px)` rule that hides the username label and shrinks button padding.

**18. Dashboard could hang on the boot spinner forever with zero feedback.** `profile.username[0]` was accessed unguarded (the only place in the codebase that didn't check first) — if it's ever empty, which is plausible given the dual-SQLite-writer / PB-admin-bug history in this file, the page throws mid-render with nothing catching it. Guarded the access, wrapped the whole render in try/catch with the existing branded error-card fallback, **and** added a global safety net in `router.js` so any future uncaught error in a page handler shows a generic "something broke, refresh" screen instead of an infinite spinner.

**19. Profile page force-logged-out the user on any error, not just an expired session.** A transient 500 or dropped connection was treated identically to "your session expired" — an actively logged-in user editing their profile on flaky wifi would just get bounced to login with no explanation. Now only a real 401 triggers logout; anything else shows a retry card like Dashboard already does.

**20. "Clear astral sign" and "clear bio" were both silently broken.** The "none" pill in Profile could never visually select itself (clicking it just deselected everything with no feedback), and the submit handler only ever sent a characteristic when it was truthy — so clearing a bio or unsetting a sign did nothing server-side, the old value just stayed. Fixed the "none" pill to select itself, and now bio/pronouns/astral_sign are always sent explicitly (including `''`), since the backend upserts by key and never clears a characteristic that's simply missing from the payload.

**21. Avatar upload was keyboard-unreachable** on both Signup step 3 and Profile — a bare `<div onClick>` with a hidden file input inside, no way to trigger it without a mouse. Added `tabindex="0" role="button"` plus Enter/Space handling on both.

**22. Error copy was Capitalized-corporate while all other copy is deliberately lowercase-zen** — the exact moment (a typo'd password, an expired code) a real tester is most likely to actually read UI copy. Lowercased every validation/error string and toast across all 9 pages. Also applied the "(you)"/"(u)" brand-punctuation convention to the highest-visibility spots where it was completely absent: the verify-email subtitle, forgot-password subtitle, the welcome-back and account-created toasts, and a new 404 quip ("lost in the (u)niverse").

**23. Signup step 3 silently dropped bio/pronouns/astral-sign/avatar if the user went back and forward again** (e.g. to fix a duplicate-email error from step 2) — none of it was persisted outside the step's own local scope. Lifted all of it into the wizard's `state.formData` and rehydrate on re-render, including re-triggering the username-availability check and re-rendering the avatar preview from the retained file.

**24. Signup step 1 (invite code) had no loading state** while every sibling form did — added the same disable + "..." pattern.

**25. No `aria-live` anywhere and native browser validation ran before the custom error UI did.** Screen-reader users got no announcement on login failure, code rejection, etc. Added `aria-live="polite"` to every error/status element and the toast container, and `novalidate` to every form so the branded error messages actually fire instead of being pre-empted by unstyled OS validation bubbles.

**26. Waitlist confirmation was a 4-second toast then an immediate bounce to a login screen the visitor can't use yet.** If the toast was missed, the user just landed on login with no memory of having joined a waitlist. Replaced with a persistent "you're on the list" confirmation state before they choose to continue to login.

**27. Password length requirement (8 chars) was inconsistently surfaced** — only in a placeholder on Signup (disappears once typing starts) and not at all on Reset Password. Added persistent hints to both plus a client-side length check on Reset.

**28. Dashboard's installed app-cards looked clickable but weren't** (pointer cursor + hover-lift with no `onClick`), and the empty devices panel was a pure dead end with no next step. Split `.app-card` into a base (non-interactive) style and `.app-card--action` (only used by the real "get more apps" card), and added explanatory copy to the empty devices state ("pair one from any thaypley app's settings to see it here").

**29. Secondary/meta text was under WCAG AA contrast** — `rgba(35,31,32,0.4–0.5)` on white computes to roughly 2.5–4.3:1 depending on the rule. Bumped `.input-label`, `.input-hint`, `.profile-handle`, `.app-card-version`, `.device-meta`, `.form-card p.subtitle`, `.form-footer`, `.catalog-card-description` to 0.65–0.7 opacity (~5:1+).

**30. Pronoun and astral-sign pills had no accessible selected-state** — pure CSS class, nothing exposed to assistive tech. Added `aria-pressed` toggling on every pill and wrapped each group in `role="radiogroup"` with a labeled `aria-label` (note: these are toggle buttons with `aria-pressed`, not true `role="radio"` children with arrow-key navigation — a reasonable stopgap for tonight, but worth a proper radio-pattern pass later).

**31. Profile page's username-availability hint was dead code** — the element existed and was mounted but nothing ever populated it or called `checkUsername()`, unlike Signup which had this working. Wired up the same debounced check.

**32. Downloads page had no retry on catalog-fetch failure** (Dashboard already had this pattern) — added it. Profile page's save handler also now specifically detects a 401 mid-session (vs. showing a raw backend error) and routes to login with an explanatory toast, preserving the distinction from finding #19.

**33.** Toast container now has `role="status"`/`aria-live="polite"`, doesn't clip against `overflow-x:hidden` on narrow phones (`@media (max-width:480px)` inset), and no longer blocks clicks on content behind it between toasts (`pointer-events` scoping).

### Backlog — logged, not implemented tonight (lower severity / needs a product decision)

- **`accountType` hardcoded to `'lover'`** at signup with no step asking whether the user is an artist/creator — a missed first-touch opportunity given "artist-first economics" is a stated platform value, not a bug. Needs a design decision on where/how to ask (extra step vs. inline toggle) before touching the wizard again.
- **STALPH (the actual brand font) is only used on the small wordmark and avatar-placeholder initials** — every page heading renders in Space Mono via the global `h1–h6` rule, not `--font-display`. Confirm this restrained usage is intentional before changing every heading.
- **Visual aesthetic reads as soft pastel-SaaS rather than distinctly cosmic** — decorative background blobs are plain radial gradients with no star/moon motif, despite shipping a full astral-sign feature that gets no matching visual treatment anywhere.
- No show/hide password toggle on any password field.
- Autofocus fires 100ms post-mount on every page, which can pop the mobile keyboard mid-transition and cause a layout jump.
- `DownloadsPage.js`'s `navigator.platform`-based OS detection is deprecated/unreliable — not a problem today since all catalog entries ship with empty download URLs (correctly disabled "coming soon" buttons), but flag before real download links go live.
- Pronoun/astral-sign pill groups use `aria-pressed` toggle buttons inside a `role="radiogroup"` rather than true `role="radio"` children with arrow-key navigation (see #30) — functional improvement over the previous zero-ARIA state, not a complete implementation of the pattern.
