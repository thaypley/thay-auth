# thay-auth

Universal auth microservice for every thaypley application. Express 5 + PocketBase + bcrypt device tokens.

## Endpoints

Public: `GET /`, `GET /auth/health`, `GET /auth/platforms` (thay ecosystem directory), `POST /auth/check-invite`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/request-password-reset`, `POST /devices/verify`, `GET /auth/catalog`.
User: `POST /auth/logout`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/send-verification`, `POST /auth/verify-email`, `POST /auth/change-username`, `POST /auth/avatar`, `DELETE /auth/avatar`, `GET/PATCH /auth/profile`, `POST /devices/pair`, `DELETE /devices/unpair`, `GET /devices`, `GET /sessions`, `DELETE /sessions/:id`, `GET/POST/DELETE /auth/apps`.
Architect only (`isArchitect=true`): `GET /auth/invites`, `POST /auth/invites`, `DELETE /auth/invites/:id` — mint & manage thay-auth signup invite codes.

## Platform hub

`GET /auth/platforms` returns every surface authenticated by thay-auth (`thaypley.com`, `fam.thaypley.com`, `werk.thaypley.com`, `du.thaypley.com`, `auth.thaypley.com`, docs). The hub SPA at `auth.thaypley.com/platforms` renders it as a launchpad; `auth.thaypley.com/invites` is an architect-only invite minting UI.

## Cross-platform avatar sync

Avatars are single-sourced on the PB `users` record. Every thay app renders the canonical URL with a `?v=avatarVersion` cache-bust — change your photo on thaypley.com or auth.thaypley.com and every connected app picks it up on its next profile fetch. `POST /auth/avatar` and `DELETE /auth/avatar` also fan out a signed webhook (`X-Thay-Signature: sha256=HMAC`) to endpoints registered in `AVATAR_SYNC_WEBHOOKS` (comma-separated) or per-install `user_apps.syncUrl`, so apps can invalidate in-memory caches instantly.

## Quick start

```sh
cp .env.example .env   # fill secrets
npm install
npm run build
npm start
```

`/auth/health` probes PocketBase; use it for orchestrator health.

## Performance

See [`PERF_OPTIMIZATION.md`](PERF_OPTIMIZATION.md) for the full load-optimization
report: measured latencies (warm `/auth/me` p50 ≈ 0.12ms), cache design, the
hand-rolled HS256 JWT layer, and the scaling/failure-mode plan. Key runtime
knobs are documented in `.env.example`; `GET /metrics` exposes Prometheus
metrics (protect it at the LB).

## PocketBase paths

- **Default** (admin API): `DIRECT_SQL_USERS` unset.
- **Direct-SQL** (`DIRECT_SQL_USERS=1`): bypasses the broken `POST /api/collections/users/records` admin endpoint by writing users straight to `pb_data/data.db`. Requires `python3` + `bcrypt` (apt: `python3-bcrypt`).

## SDK

`@thay/auth-sdk` lives in `sdk/`. Build with `cd sdk && npm install && npm run build`. Dist lands in `sdk/dist/`.

## Deploy

GitHub Action on push to `main` SSHes to VPS and runs `scripts/deploy.sh`. See
`.github/workflows/deploy.yml` and `scripts/deploy.sh`.

Manual: `./scripts/deploy.sh` (uses the `thaypley-vps` SSH alias; secrets live in
`/docker/thay-auth/.env` on the VPS and are never uploaded).

### Public routing (verified 2026-08)

- `api.thaypley.com` → Cloudflare → VPS nginx → `127.0.0.1:3749` — **works**.
- `auth.thaypley.com` → Cloudflare → **serves the SPA for every path** (even
  `/api/*`); the VPS nginx receives **zero** requests for this host. Diagnosis:
  the Cloudflare DNS record for `auth.thaypley.com` points at a static-SPA
  origin (or a host override), not this VPS (`5.181.218.124`). Direct
  `curl -k -H 'Host: auth.thaypley.com' https://5.181.218.124/auth/health`
  returns the correct JSON, so nginx is fine.
  **Fix (Cloudflare dashboard, needs account access):** set `auth.thaypley.com`
  A record → `5.181.218.124` (proxied, SSL Full/Strict), remove any origin rule /
  host-header override pointing it at the SPA origin.

**Verify after the DNS change:**

```bash
# 1. The VPS nginx must actually receive auth.thaypley.com traffic
curl -k -H 'Host: auth.thaypley.com' https://5.181.218.124/auth/health
# → expect JSON: {"ok":true,...} — proves Cloudflare reaches nginx for this host

# 2. The health probe must never be cached (liveness checks see live state)
curl -sI -H 'Host: auth.thaypley.com' https://5.181.218.124/auth/health | grep -i cache-control
# → expect: cache-control: no-store

# 3. nginx config is valid before anything reloads
ssh thaypley-vps 'sudo nginx -t'

# 4. Apply only after the config test passes
ssh thaypley-vps 'sudo systemctl reload nginx'
```

After the A-record change propagates, `auth.thaypley.com/auth/health` must return
live JSON through Cloudflare (not the SPA's index.html). If it still serves HTML,
the origin rule / host-header override in Cloudflare is still pointing the host
at the static SPA origin — remove that override and re-verify.
