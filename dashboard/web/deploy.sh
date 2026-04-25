#!/usr/bin/env bash
# Killzone dashboard frontend deploy
#
# Idempotent build + restart for dashboard/web running on VPS.
# Run from VPS as root (or anything with sudo for systemctl).
#
#   bash /docker/roce-os/dashboard/web/deploy.sh
#
# Steps:
#   1. cd to repo dashboard/web
#   2. npm install (idempotent — only fetches if package-lock changed)
#   3. npx next build (uses .env.production from this dir)
#   4. systemctl restart ict-dashboard-web
#   5. curl smoke-test the public URL
#
# Rollback path: if anything fails, the systemd unit can be repointed at
# /opt/ict-dashboard-full (the legacy location, kept in place during cutover).

set -euo pipefail
cd "$(dirname "$0")"

echo "==> install"
npm install --silent --no-audit --no-fund

echo "==> build"
npx next build 2>&1 | tail -15

echo "==> restart service"
systemctl restart ict-dashboard-web
sleep 5

echo "==> smoke test"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://dashboard.ictwealthbuilding.com/ || echo 000)
if [ "$code" = "200" ]; then
  echo "✅ dashboard.ictwealthbuilding.com -> $code"
  echo "✅ deploy succeeded"
else
  echo "❌ dashboard returned HTTP $code — check journalctl -u ict-dashboard-web -n 30"
  exit 1
fi
