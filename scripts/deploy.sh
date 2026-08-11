#!/usr/bin/env bash
# scripts/deploy.sh — manual deploy to VPS. Invoked by zero cli or by hand.
#
# Usage:
#   VPS_HOST=5.181.218.124 VPS_USER=root ./scripts/deploy.sh
#   THAY_AUTH_REMOTE=thaypley-vps ./scripts/deploy.sh
#
# Secrets (PB_ADMIN_PASSWORD, THAY_AUTH_JWT_SECRET, SMTP_PASS) must already
# exist on the VPS in /docker/thay-auth/.env. This script does NOT upload
# secrets. Rotate them out-of-band (scp, ansible vault, 1password CLI, etc).

set -euo pipefail

REMOTE="${THAY_AUTH_REMOTE:-${VPS_HOST:-thaypley-vps}}"
APP_DIR="${THAY_AUTH_APP_DIR:-/docker/thay-auth}"
PB_DATA_DIR="${THAY_AUTH_PB_DATA_DIR:-/home/thaypley/pocketbase/pb_data}"
PB_HOOKS_DIR="${THAY_AUTH_PB_HOOKS_DIR:-/home/thaypley/pocketbase/pb_hooks}"
SPA_DEPLOY_DIR="/var/www/auth.thaypley.com"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── 1. Build the homebase SPA (auth.thaypley.com front-end) ──────────
echo "→ Building homebase SPA"
( cd "${ROOT}/homebase" && npm run build )

# ── 2. Deploy API microservice ───────────────────────────────────────
echo "→ Deploying thay-auth to ${REMOTE}:${APP_DIR}"

ssh "${REMOTE}" "set -euo pipefail
  cd ${APP_DIR}
  echo '→ git pull'
  git pull --ff-only origin main
  echo '→ sync pb_hooks to PocketBase hooks dir'
  mkdir -p ${PB_HOOKS_DIR:-/home/thaypley/pocketbase/pb_hooks}
  rsync -a --delete --exclude '*.bak' pb_hooks/ ${PB_HOOKS_DIR:-/home/thaypley/pocketbase/pb_hooks}/
  echo '→ chown PB data dir to in-container node uid (1000)'
  chown -R 1000:1000 ${PB_DATA_DIR}
  echo '→ docker compose build'
  docker compose build
  echo '→ docker compose up -d'
  docker compose up -d
  echo '→ waiting for healthy'
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status=\$(docker inspect --format='{{.State.Health.Status}}' thay-auth 2>/dev/null || echo unknown)
    echo \"  [\${i}0s] \${status}\"
    [ \"\${status}\" = 'healthy' ] && break
    sleep 10
  done
  docker compose ps
  docker compose logs --tail=40 thay-auth || true
"

# ── 3. Deploy the homebase SPA static files ──────────────────────────
echo "→ Syncing homebase SPA to ${SPA_DEPLOY_DIR}"
ssh "${REMOTE}" "mkdir -p ${SPA_DEPLOY_DIR}"
rsync -az --delete --exclude '*.bak' "${ROOT}/homebase/dist/" "${REMOTE}:${SPA_DEPLOY_DIR}/"
# Make the favicon available at the root (nginx serves it)
scp -q "${ROOT}/homebase/dist/assets/favicon.svg" "${REMOTE}:${SPA_DEPLOY_DIR}/favicon.svg" 2>/dev/null || true

# ── 4. Install nginx site config + reload ────────────────────────────
echo "→ Installing nginx config for auth.thaypley.com"
scp -q "${ROOT}/config/auth.thaypley.com" "${REMOTE}:/etc/nginx/sites-available/auth.thaypley.com.new"
ssh "${REMOTE}" "set -euo pipefail
  cp /etc/nginx/sites-available/auth.thaypley.com /etc/nginx/sites-available/auth.thaypley.com.bak-\$(date +%s) 2>/dev/null || true
  mv /etc/nginx/sites-available/auth.thaypley.com.new /etc/nginx/sites-available/auth.thaypley.com
  nginx -t
  systemctl reload nginx
"

echo "✓ Deploy complete. Verify:"
echo "  curl https://auth.thaypley.com/             → SPA HTML"
echo "  curl https://auth.thaypley.com/auth/health → API JSON"
