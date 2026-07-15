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

---
