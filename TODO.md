## 2026-07-14 — Session Handoff

### Completed
- Fixed root cause of "PocketBase is being difficult": all 7 `pb_migrations/*.js` used pre-v0.23 `SchemaField` wrapper syntax + hardcoded/wrong relation collection ids. Rewrote to plain-object fields + dynamic `app.findCollectionByNameOrId(...).id` lookups. Verified by booting the real `pocketbase` v0.39.5 binary locally — all collections apply clean.
- Fixed two real bugs in `src/routes/auth.ts`: `/login` never checked `isVerified` (now blocks with 403 `EMAIL_NOT_VERIFIED`); `/verify-email` wrote a nonexistent `emailVerified` field. Added `/auth/change-username` with 30-day cooldown.
- Verified full local flow end-to-end: signup w/ invite → blocked-until-verified login → verify → login → username cooldown → device pairing/token-verify. All green.
- **Major discovery**: `https://thaypley.com/hcgi/platform` is NOT an empty/future instance — it's the live, ~200-collection production PocketBase already backing all of thaypley.com (social, commerce, tunes, fam/werk/du app data, savant AI system). It already has `users` (~150 fields), `signup_invites`, `signup_waitlist`, `email_change_requests` in shapes nearly identical to thay-auth's own migrations.
- **Decision locked in**: thay-auth targets this existing instance as the single source of truth, not a separate PocketBase. Added `devices`/`sessions`/`auth_codes` to it (purely additive, verified nothing else touched, collection count 199→202). Restored `emailVerified` alongside `isVerified` in the verify route to match the real schema.
- Containerized thay-auth (`Dockerfile` + `docker-compose.yml`, hardened like dabba: 127.0.0.1-only, read-only rootfs, cap-drop all). Repo pushed to `github.com/thaypley/thay-auth` (public — see blockers for why).
- **Deployed to VPS 1477936** (Hostinger, `5.181.218.124`, alongside dabba). Container is up, healthy, confirmed reaching `hcgi/platform`. Currently bound to `127.0.0.1:3749` only — not yet publicly reachable.

### Blockers / dead ends (so the next session doesn't re-walk them)
- GHCR (`ghcr.io/thaypley/thay-auth`) package visibility is **locked private by thaypley org policy** — cannot be flipped via web UI or API (confirmed 404/403 both ways, even by the account owner). Don't retry the "publish image to GHCR, pull on VPS" pattern for this org.
- Fix that worked instead: made the **repo** public (not the package — separate concept, no secrets in the repo since `.env` is gitignored) and used a Docker git-context build: `build: { context: "https://github.com/thaypley/thay-auth.git#main" }`.
- Hostinger's own deploy tools (`VPS_createNewProjectV1` / `VPS_updateProjectV1`) unconditionally run `docker compose pull` before `up` and treat a failed pull as **fatal** — they never fall back to `docker compose build` even with a `build:` directive present. These tools alone cannot deploy a build-from-source project. Worked around by SSHing in directly (`ssh thaypley-vps`, key at `~/.ssh/thaypley_vps`, root) and running `docker compose build && docker compose up -d` by hand.
- Real build/deploy errors are NOT visible through the Hostinger MCP tools (`getProjectLogsV1` says "project not found" when zero containers exist). The actual log lives on the VPS at `/docker/<project>/.build.log` — check that directly over SSH before assuming a tool failure needs blind guessing.
- No SMTP is configured in prod yet — `src/utils/email.ts` gracefully no-ops (logs a warning, returns false) rather than crashing, so this doesn't block anything, but real users won't get verification emails until it's wired up.

### Next Session
- [ ] **Fix PocketBase user creation**: v0.25.0 has a bug where admin API returns 400 `data:{}` on any auth record create. v0.27.0/v0.30.0 same issue. v0.39.6 fails on migration `1778828400_normalize_indexes.go` (rule validation across 202 collections). Options:
  - Attempt PB upgrade through specific intermediate versions (need to find first version where admin auth-create works AND DB migration succeeds)
  - OR modify `src/providers/pocketbase.ts` to create users via direct SQLite INSERT (write to `data.db`'s `users` table, hash password with bcrypt, then let PB pick it up)
  - OR use `pocketbase superuser` CLI to bootstrap the first user, then let thay-auth handle the rest
- [ ] **Re-enable PB hooks** currently stashed at `/home/thaypley/pocketbase/pb_hooks_disabled/` (moved back for debugging) — `user-verification-email.pb.js` and `enforce_architect_limit.pb.js` particularly
- [ ] **Decide production email**: SMTP is actually configured (host: `smtp.resend.com`, port 465, enabled) — just no credentials in thay-auth's `.env`. Fill `SMTP_USER`/`SMTP_PASS` from Resend or leave no-op.
- [ ] **Wire `thaypley-tunes-desktop`** via device-token flow (no PB creation needed — `/devices/pair` uses user JWT, which works)
- [ ] Revisit `CORS_ORIGINS` and documentation notes from prior session

## 2026-07-14 — Session Handoff

### Completed
- Fronted thay-auth with nginx + Let's Encrypt TLS at `auth.thaypley.com` (config under `/etc/nginx/sites-available/auth.thaypley.com`, certbot-managed). Container itself stayed 127.0.0.1:3749.
- Verified both public endpoints return 200: `https://auth.thaypley.com/health` and `https://auth.thaypley.com/api/health`. Browser-testable.
- Confirmed by direct probe + browser that the bug is reproducible across PB majors: **admin `POST /api/collections/users/records` returns `400 {data:{}}` on v0.25.0, v0.27.0, v0.30.0** with the real `hcgi/platform` data. v0.39.6 upgrade path blocked by `1778828400_normalize_indexes.go` failing rule-validation across all 202 collections.
- Decided not to keep fighting PB versions blindly. Reverted prod PB to v0.25.0 (last known stable for this dataset) and **restored hooks** from `/home/thaypley/pocketbase/pb_hooks_disabled/` — `user-verification-email.pb.js` + `enforce_architect_limit.pb.js` back in place.

### Blockers
- None new. The PB admin-create bug is now a known constraint, not a mystery — three majors tested, root cause not yet identified (likely a custom rule or hook interaction specific to the hcgi dataset, not a stock PB regression).

### Next Session
- [ ] **Binary-search PB versions** with a `pocketbase migrate up --dryRun` first to find the highest version where admin auth-create works AND the index-normalize migration passes. Check v0.31.0, 0.33.0, 0.36.0 as likely candidates between known-broken 0.30 and known-failing 0.39.6.
- [ ] **If no PB version works**: patch `src/providers/pocketbase.ts` `createUser()` to do direct SQLite `INSERT INTO users` (id, email, passwordHash via bcrypt, isVerified=0) against `pb_data/data.db`, then call PB's `authRefresh` to issue a JWT. Bypasses the admin API bug entirely. Add a feature flag `DIRECT_SQL_USERS=1` so the admin path stays as fallback.
- [ ] **Verify signup end-to-end** on the chosen path: invite-code → POST `/auth/signup` → user row exists → verify email (logged link) → POST `/auth/login` → JWT → POST `/devices/pair` → device token. Curl each step against `https://auth.thaypley.com`.
- [ ] Wire `SMTP_USER`/`SMTP_PASS` for Resend so real verification emails actually send (currently no-op with a warn-log).

### Reference (additive)
- Public URL: `https://auth.thaypley.com` (nginx → 127.0.0.1:3749). TLS cert auto-renews via certbot systemd timer.
- nginx config: `/etc/nginx/sites-available/auth.thaypley.com` (symlinked to `sites-enabled/`). Proxy_pass `http://127.0.0.1:3749`. Adds `X-Forwarded-For`/`X-Forwarded-Proto`.
- PB versions tested in prod: v0.25.0 (current, working minus admin-create), v0.27.0, v0.30.0 (same admin-create bug), v0.39.6 (migration fail).
- Hooks restored to `/home/thaypley/pocketbase/pb_hooks/`: `user-verification-email.pb.js`, `enforce_architect_limit.pb.js`.

### Reference
- VPS: Hostinger VM `1477936`, `srv1477936.hstgr.cloud`, `5.181.218.124`. SSH: `ssh thaypley-vps` (root, key `~/.ssh/thaypley_vps`).
- Deploy path on VPS: `/docker/thay-auth/` (`docker-compose.yml`, `.env`, `.build.log`).
- Repo: `github.com/thaypley/thay-auth` (public, main branch).
- Local dev: PocketBase on `127.0.0.1:8091` (dev-only schema), Express on `127.0.0.1:3749`, both started via plain `nohup` — not yet under launchd/pm2, restart by hand.
- Full narrative + all pivotal decisions: see the `project_thay_auth` memory entry.

## 2026-07-15 (evening) — Session Handoff

### Completed
- **Spinner root cause fixed** (7241904): lazy page loaders in `homebase/src/main.js` never invoked the loaded page fn. `modulePreload:false` + crossorigin-sed kept as hardening.
- **uazit login unblocked**: PATCHed `isVerified`/`emailVerified` true via PB superuser API (record UPDATE works despite the CREATE bug). Login confirmed working by user.
- **Login accepts username OR email**: frontend identity field + API-side username→email lookup (PB `identityFields` only has `email`; left the shared prod collection config untouched).
- **STALPH brand font** live (4b9e74f).
- **SDK was missing half its methods** (`setToken`, `getProfile`, `getApps`, `checkUsername`, `setCharacteristics`, `changeUsername`) — pages called them; added all + `uploadAvatar`/`removeAvatar`. `auth.setToken` was called at boot for returning users → would have thrown.
- **Verification flow**: `/login` now returns `token`+`user` on the EMAIL_NOT_VERIFIED 403 (password already matched); new `/verify` page auto-sends a 6-digit code with resend cooldown; signup routes into it; dashboard bounces unverified users to it.
- **Avatar**: `POST/DELETE /auth/avatar` (base64 JSON, 4MB cap → PB `users.avatar` file field, admin FormData update); file URLs built on `PB_PUBLIC_URL` (default `https://thaypley.com/hcgi/platform`); picker in signup step 3 + profile edit.
- **Astral sign auto-computed** from birthday (`homebase/src/utils/zodiac.js`), preselected in signup, still changeable.
- **Local e2e green**: invite → signup → unverified login 403+token → send-verification → verify-email → login 200 → avatar upload → characteristics → profile. Test data cleaned up.

### Deployed & verified in prod (same session, later)
- `DIRECT_SQL_USERS=1` live on VPS; data.db owner uid 1000 == container node uid → writable. **Prod e2e green**: invite → signup 201 (direct-SQL row, PB issued a token for it) → send-verification → verify-email → login-by-username 200. Test user + invites deleted after.
- SMTP creds recovered from PB `_params` (settings stored plaintext; settings *API* masks them) into `/docker/thay-auth/.env`; `SMTP_HOST`/`SMTP_PORT` were EMPTY there and are now smtp.resend.com:465, `SMTP_FROM=hello@thaypley.com`. SMTP auth to Resend works.
- CF Pages deployed the new SPA (verify flow in live bundle), GH Actions deploy green.

### ~~BLOCKED~~ RESOLVED 2026-07-16: user verified thaypley.com on Resend; test email through the container's SMTP path returned `250` (delivered to thaypley@gmail.com). Verification emails fully live.

### (was) BLOCKED on user: Resend domain verification
- Resend rejects sends with `550 domain not verified` — the account has **no verified domain**, so PB's own emails were never delivering either. The VPS API key is send-only restricted (can't create domains via API).
- User must: resend.com → Domains → Add `thaypley.com` (region: pick closest) → use Resend's "Connect to Cloudflare" auto-DNS (zone is on Cloudflare; Hostinger mailbox MX/SPF at root are untouched — Resend uses `send.` subdomain + DKIM). Once status = verified, verification emails flow with zero code/config changes.
- Until then signup works but codes must be read from the user record by an admin (or flags flipped manually).

### Next Session
- [x] Resend domain verified + SMTP send confirmed (250) — self-serve signup fully operational
- [ ] Wire `thaypley-tunes-desktop` via device-token flow
- [ ] Consider: nightly cleanup of expired invites; rate-limit send-verification per user

## 2026-07-15 — Session Handoff

### Completed
- **nginx config rewritten cleanly** for `api.thaypley.com`. TLS via certbot. `curl https://api.thaypley.com/auth/health` → 200.
- **Proxy gap fixed**: removed CF Pages function (`homebase/functions/api/[[path]].js` — CF error 1003, blocked same-account fetch). Direct browser-to-API instead:
  - SDK `baseUrl` set to `https://api.thaypley.com` in prod
  - `CORS_ORIGINS` on VPS updated to include `https://auth.thaypley.com` — container restarted
  - CORS preflight confirmed: `access-control-allow-origin` returns correct origin
- **SDK inlined**: `@thaypley/auth-sdk` (file dep `../sdk`) removed; SDK dist copied to `homebase/src/auth-sdk-lib.js`. CF Pages build can't resolve `file:` deps.
- **CF Pages build fixed**: build command changed `pnpm run build` → `npm run build` (project uses npm, not pnpm). Fresh deploy succeeded — `uses_functions: false`, `dist/` deployed to `auth.thaypley.com`.
- **VPS deploy fixed**: cloned full git repo to `/docker/thay-auth` (was files-only, no `.git` — GH Actions `git pull` failed). Now git-aware.
- **GH Actions secrets restored**: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` were empty/missing. Set via `gh secret set`. Deploy run `29408797365` → `conclusion=success`.
- **All pushed**: commits `6f11f5c` `02de64f` `dd9328a` on main. VPS at `dd9328a`, container healthy, PB admin authed. GH Actions deploy green.

### Next Session
- [ ] **Verify GH Actions deploy** passes on next push (git clone fix should resolve the previous `fatal: not a git repository` error)
- [ ] **Wire SMTP_USER/SMTP_PASS** for Resend so verification emails actually send (currently no-op with warn-log)
- [ ] **Binary-search PB versions** to fix admin `POST /api/collections/users/records` 400 bug, or finalize `DIRECT_SQL_USERS` path
- [ ] **Verify signup end-to-end** with curl: invite-code → POST `/auth/signup` → user exists → verify email → POST `/auth/login` → JWT → POST `/devices/pair` → device token
- [ ] **Wire `thaypley-tunes-desktop`** via device-token flow

### Reference
- SPA: `https://auth.thaypley.com` (CF Pages, no functions)
- API: `https://api.thaypley.com` (nginx → 127.0.0.1:3749 → thay-auth container)
- CORS origins: `https://thaypley.com,https://du.thaypley.com,https://fam.thaypley.com,https://werk.thaypley.com,https://auth.thaypley.com`
- VPS: Hostinger VM 1477936, `ssh thaypley-vps` (root). Deploy: `/docker/thay-auth/`
- Repo: `github.com/thaypley/thay-auth` (public, main)
- CF Pages build: `npm run build` in `homebase/`, `dist/` output
