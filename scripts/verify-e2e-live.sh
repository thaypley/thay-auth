#!/usr/bin/env bash
# End-to-end verification of the LIVE thay-auth API from the VPS host.
set -euo pipefail

PB="${PB:-http://127.0.0.1:8090}"
API="${API:-http://127.0.0.1:3749}"
ENV_FILE="/docker/thay-auth/.env"

PB_EMAIL=$(grep '^PB_ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)
PB_PASS=$(grep '^PB_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

echo "== PB admin auth =="
ADMIN=$(curl -sf -X POST "$PB/api/collections/_superusers/auth-with-password" -H 'Content-Type: application/json' -d "{\"identity\":\"$PB_EMAIL\",\"password\":\"$PB_PASS\"}")
TOKEN=$(echo "$ADMIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "admin token: ${TOKEN:0:12}..."

CODE="TP-E2E$(date +%s | tail -c 6)"
echo "== mint invite $CODE =="
EXPIRES=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
curl -sf -X POST "$PB/api/collections/signup_invites/records" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\",\"maxUses\":1,\"useCount\":0,\"createdBy\":\"verify\",\"expiresAt\":\"$EXPIRES\"}" >/dev/null
echo "invite minted"

TS=$(date +%s | tail -c 6)
EMAIL="verify-e2e-$TS@thaypley.com"
USERNAME="verify_$TS"
PASSWORD='Verify-E2E-2026!x'

echo "== signup $EMAIL =="
SIGNUP=$(curl -s -w "\n%{http_code}" -X POST "$API/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"username\":\"$USERNAME\",\"accountType\":\"musician\",\"birthday\":\"2000-01-15\",\"inviteCode\":\"$CODE\"}")
SCODE=$(echo "$SIGNUP" | tail -1)
SBODY=$(echo "$SIGNUP" | head -n -1)
echo "signup status: $SCODE"
TOKEN2=$(echo "$SBODY" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN2" ]; then
  echo "❌ no token in signup response"
  echo "$SBODY" | head -c 300; echo
  exit 2
fi

echo "== GET /auth/profile (the endpoint that returned 500) =="
PROF=$(curl -s -w "\n%{http_code}" "$API/auth/profile" -H "Authorization: Bearer $TOKEN2")
PCODE=$(echo "$PROF" | tail -1)
PBODY=$(echo "$PROF" | head -n -1)
echo "profile status: $PCODE"
echo "$PBODY" | head -c 400; echo

echo "== GET /auth/apps (dashboard companion) =="
APPS=$(curl -s -o /dev/null -w "%{http_code}" "$API/auth/apps" -H "Authorization: Bearer $TOKEN2")
echo "apps status: $APPS"

if [ "$PCODE" = "200" ] && [ "$APPS" = "200" ]; then
  echo "🎉 E2E PASSED"
else
  echo "❌ E2E FAILED"
  exit 1
fi
