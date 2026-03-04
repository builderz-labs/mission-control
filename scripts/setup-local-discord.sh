#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

required_cmds=(node pnpm openclaw jq curl)
for cmd in "${required_cmds[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[setup-local-discord] missing required command: $cmd" >&2
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
fi

read_env() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'$/\1/"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { replaced=0 }
    $0 ~ "^[[:space:]]*" k "=" {
      print k "=" v
      replaced=1
      next
    }
    { print }
    END {
      if (!replaced) {
        print k "=" v
      }
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

gateway_json="$(openclaw gateway status --json)"
gateway_running="$(jq -r '.service.runtime.status == "running"' <<<"$gateway_json")"
gateway_rpc_ok="$(jq -r '.rpc.ok == true' <<<"$gateway_json")"
if [[ "$gateway_running" != "true" || "$gateway_rpc_ok" != "true" ]]; then
  echo "[setup-local-discord] openclaw gateway is not healthy/running" >&2
  exit 1
fi

channels_json="$(openclaw channels status --json)"
discord_configured="$(jq -r '.channels.discord.configured // false' <<<"$channels_json")"
discord_running="$(jq -r '.channels.discord.running // false' <<<"$channels_json")"
if [[ "$discord_configured" != "true" || "$discord_running" != "true" ]]; then
  echo "[setup-local-discord] discord channel is not configured/running" >&2
  exit 1
fi

upsert_env "OPENCLAW_HOME" "$HOME/.openclaw"
upsert_env "OPENCLAW_GATEWAY_HOST" "127.0.0.1"
upsert_env "OPENCLAW_GATEWAY_PORT" "18789"
upsert_env "NEXT_PUBLIC_GATEWAY_HOST" "127.0.0.1"
upsert_env "NEXT_PUBLIC_GATEWAY_PORT" "18789"

current_allowed_hosts="$(read_env MC_ALLOWED_HOSTS || true)"
if [[ -z "$current_allowed_hosts" ]]; then
  merged_allowed_hosts="localhost,127.0.0.1"
else
  merged_allowed_hosts="$current_allowed_hosts"
  if [[ ",$merged_allowed_hosts," != *",localhost,"* ]]; then
    merged_allowed_hosts+="${merged_allowed_hosts:+,}localhost"
  fi
  if [[ ",$merged_allowed_hosts," != *",127.0.0.1,"* ]]; then
    merged_allowed_hosts+="${merged_allowed_hosts:+,}127.0.0.1"
  fi
fi
upsert_env "MC_ALLOWED_HOSTS" "$merged_allowed_hosts"

api_key="$(read_env API_KEY || true)"
if [[ -z "$api_key" || "$api_key" == "generate-a-random-key" ]]; then
  api_key="$(dd if=/dev/urandom bs=24 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  upsert_env "API_KEY" "$api_key"
fi

cd "$REPO_ROOT"
pnpm install
pnpm build

echo "[setup-local-discord] complete"
echo "[setup-local-discord] env file: $ENV_FILE"
echo "[setup-local-discord] gateway healthy: true"
echo "[setup-local-discord] discord running: true"
