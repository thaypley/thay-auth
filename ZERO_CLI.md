# Zero CLI integration for thay-auth

## Deploy from zero cli

The `zero` cli shells into the VPS and runs the deploy script.

```
zero deploy
```

Resolves to `scripts/deploy.sh` (or whatever `zero deploy` is configured to
invoke) → SSH to `thaypley-vps` → `cd /docker/thay-auth && git pull && chown -R 1000:1000 /home/thaypley/pocketbase/pb_data && docker compose build && docker compose up -d`.

Override the remote:

```
zero deploy --remote thaypley-vps
```

## GitHub deploy (preferred)

Push to `main` on `github.com/thaypley/thay-auth` triggers
`.github/workflows/deploy.yml` which SSHes the same way. Required secrets on
the GitHub repo:

- `VPS_HOST` — e.g. `5.181.218.124`
- `VPS_USER` — e.g. `root`
- `VPS_SSH_KEY` — private key matching `~/.ssh/thaypley_vps.pub` on the VPS

## Hostinger MCP note

`VPS_createNewProjectV1` / `VPS_updateProjectV1` are known to fail for
build-from-source projects (they `docker compose pull` first and treat a
failed pull as fatal). Do not use them for thay-auth. Use the GitHub Action
or `zero deploy` instead.

## Health

```
curl https://auth.thaypley.com/auth/health
```

Returns 200 with PB health when up; 503 when PB unreachable.
