# thay-auth

Universal auth microservice for every thaypley application. Express 5 + PocketBase + bcrypt device tokens.

## Endpoints

Public: `GET /`, `GET /auth/health`, `POST /auth/check-invite`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/request-password-reset`, `POST /devices/verify`.
User: `POST /auth/logout`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/send-verification`, `POST /auth/verify-email`, `POST /auth/change-username`, `POST /devices/pair`, `DELETE /devices/unpair`, `GET /devices`, `GET /sessions`, `DELETE /sessions/:id`.

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
