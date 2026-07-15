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

echo "→ Deploying thay-auth to ${REMOTE}:${APP_DIR}"

ssh "${REMOTE}" "set -euo pipefail
  cd ${APP_DIR}
  echo '→ git pull'
  git pull --ff-only origin main
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

echo "✓ Deploy complete. Verify: curl https://auth.thaypley.com/auth/health"
