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

## PocketBase paths

- **Default** (admin API): `DIRECT_SQL_USERS` unset.
- **Direct-SQL** (`DIRECT_SQL_USERS=1`): bypasses the broken `POST /api/collections/users/records` admin endpoint by writing users straight to `pb_data/data.db`. Requires `python3` + `bcrypt` (apt: `python3-bcrypt`).

## SDK

`@thay/auth-sdk` lives in `sdk/`. Build with `cd sdk && npm install && npm run build`. Dist lands in `sdk/dist/`.

## Deploy

GitHub Action on push to `main` SSHes to VPS and runs `scripts/deploy.sh`. See `.github/workflows/deploy.yml` and `scripts/deploy.sh`.
