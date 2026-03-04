#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"
MISSION_CONTROL_BASE_URL="${MISSION_CONTROL_BASE_URL:-http://127.0.0.1:3005}"

failures=()

read_env() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'$/\1/"
}

record_failure() {
  local msg="$1"
  failures+=("$msg")
}

if ! command -v openclaw >/dev/null 2>&1; then
  record_failure "missing command: openclaw"
fi
if ! command -v jq >/dev/null 2>&1; then
  record_failure "missing command: jq"
fi
if ! command -v curl >/dev/null 2>&1; then
  record_failure "missing command: curl"
fi

if [[ ${#failures[@]} -eq 0 ]]; then
  gateway_json="$(openclaw gateway status --json || true)"
  if [[ -z "$gateway_json" ]] || ! jq -e . >/dev/null 2>&1 <<<"$gateway_json"; then
    record_failure "unable to read openclaw gateway status --json"
  else
    gateway_running="$(jq -r '.service.runtime.status == "running"' <<<"$gateway_json")"
    gateway_rpc_ok="$(jq -r '.rpc.ok == true' <<<"$gateway_json")"
    if [[ "$gateway_running" != "true" ]]; then
      record_failure "gateway service is not running"
    fi
    if [[ "$gateway_rpc_ok" != "true" ]]; then
      record_failure "gateway rpc probe is not healthy"
    fi
  fi

  channels_json="$(openclaw channels status --json || true)"
  if [[ -z "$channels_json" ]] || ! jq -e . >/dev/null 2>&1 <<<"$channels_json"; then
    record_failure "unable to read openclaw channels status --json"
  else
    discord_configured="$(jq -r '.channels.discord.configured // false' <<<"$channels_json")"
    discord_running="$(jq -r '.channels.discord.running // false' <<<"$channels_json")"
    telegram_present="$(jq -r '((.channels.telegram.configured // false) or (.channels.telegram.running // false))' <<<"$channels_json")"

    if [[ "$discord_configured" != "true" ]]; then
      record_failure "discord channel is not configured"
    fi
    if [[ "$discord_running" != "true" ]]; then
      record_failure "discord channel is not running"
    fi
    if [[ "$telegram_present" == "true" ]]; then
      record_failure "telegram channel is configured/running; expected discord-only"
    fi
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  record_failure ".env.local is missing at $ENV_FILE"
fi

api_key="$(read_env API_KEY || true)"
if [[ -z "$api_key" || "$api_key" == "generate-a-random-key" ]]; then
  record_failure "API_KEY missing or placeholder in .env.local"
fi

call_and_check() {
  local path="$1"
  local name="$2"
  local body_file
  body_file="$(mktemp)"
  local code
  code="$(curl -sS -m 10 -o "$body_file" -w "%{http_code}" -H "x-api-key: $api_key" "$MISSION_CONTROL_BASE_URL$path" || true)"
  local body
  body="$(cat "$body_file")"
  rm -f "$body_file"

  if [[ "$code" != "200" ]]; then
    record_failure "$name returned HTTP $code"
    return
  fi

  if ! jq -e . >/dev/null 2>&1 <<<"$body"; then
    record_failure "$name response is not valid JSON"
    return
  fi

  if [[ "$name" == "status gateway" ]]; then
    if ! jq -e 'has("running") and has("port") and has("port_listening")' >/dev/null 2>&1 <<<"$body"; then
      record_failure "$name response missing expected keys"
    fi
  fi

  if [[ "$name" == "status overview" ]]; then
    if ! jq -e 'has("timestamp") and has("memory") and has("sessions")' >/dev/null 2>&1 <<<"$body"; then
      record_failure "$name response missing expected keys"
    fi
  fi
}

if [[ ${#failures[@]} -eq 0 ]]; then
  call_and_check "/api/status?action=gateway" "status gateway"
  call_and_check "/api/status?action=overview" "status overview"
fi

echo "[validate-local-discord] mission-control base url: $MISSION_CONTROL_BASE_URL"
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "[validate-local-discord] result: PASS"
  exit 0
fi

echo "[validate-local-discord] result: FAIL"
for item in "${failures[@]}"; do
  echo "[validate-local-discord] - $item"
done
exit 1
