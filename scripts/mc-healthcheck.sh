#!/usr/bin/env bash
set -euo pipefail

MC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$MC_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing .env at $ENV_FILE"
  exit 1
fi

set -o allexport
# shellcheck disable=SC1090
source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
set +o allexport

PORT_VALUE="${PORT:-3244}"
BASE_URL="http://127.0.0.1:${PORT_VALUE}"
HEALTH_URL="$BASE_URL/api/status?action=health"

echo "→ Checking UI endpoint: $BASE_URL/login"
UI_CODE="000"
for _ in {1..30}; do
  UI_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login" || true)"
  [[ "$UI_CODE" == "200" ]] && break
  sleep 1
done
if [[ "$UI_CODE" != "200" ]]; then
  echo "❌ UI check failed (HTTP $UI_CODE)"
  exit 1
fi

echo "→ Checking health endpoint: $HEALTH_URL"
if [[ -n "${API_KEY:-}" ]]; then
  HEALTH_JSON="$(curl -sS "$HEALTH_URL" -H "x-api-key: $API_KEY")"
else
  HEALTH_JSON="$(curl -sS "$HEALTH_URL")"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "⚠️ jq not found; raw health response:"
  echo "$HEALTH_JSON"
  echo "✅ UI endpoint reachable"
  exit 0
fi

# Support both object-style and array-style health payloads
if echo "$HEALTH_JSON" | jq -e '.checks | type == "array"' >/dev/null 2>&1; then
  GATEWAY_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks[] | select(.name|test("Gateway"; "i")) | .status' | head -n1)"
  DISK_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks[] | select(.name|test("Disk"; "i")) | .status' | head -n1)"
  MEM_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks[] | select(.name|test("Memory"; "i")) | .status' | head -n1)"
else
  GATEWAY_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks.gateway.status // "unknown"')"
  DISK_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks.disk.status // "unknown"')"
  MEM_STATUS="$(echo "$HEALTH_JSON" | jq -r '.checks.memory.status // "unknown"')"
fi

echo "→ gateway: ${GATEWAY_STATUS:-unknown}"
echo "→ disk:    ${DISK_STATUS:-unknown}"
echo "→ memory:  ${MEM_STATUS:-unknown}"

if [[ "${GATEWAY_STATUS:-}" != "ok" && "${GATEWAY_STATUS:-}" != "healthy" ]]; then
  echo "❌ Gateway health is not ok"
  exit 1
fi

echo "✅ Mission Control healthcheck passed"
