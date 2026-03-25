#!/usr/bin/env bash
# Mission Control service wrapper — sources .env then starts Next.js in production.
# Used by launchd at ai.missioncontrol.

set -euo pipefail

MC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$MC_DIR/.env"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NEXT_BIN="$MC_DIR/node_modules/next/dist/bin/next"

if [[ -f "$ENV_FILE" ]]; then
  # Export all non-comment, non-empty vars from .env
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
  set +o allexport
fi

# NOTE: Do not call `openclaw config get gateway.auth.token` here.
# OpenClaw redacts sensitive values in CLI output, which can poison runtime auth.
# Keep OPENCLAW_GATEWAY_TOKEN sourced from `.env` (or explicit launchd env) only.

export NODE_ENV="${NODE_ENV:-production}"
PORT_VALUE="${PORT:-3244}"
BIND_HOST="${MC_BIND_HOST:-${HOSTNAME:-127.0.0.1}}"
export PORT="$PORT_VALUE"
export HOSTNAME="$BIND_HOST"

cd "$MC_DIR"

if [[ -f "$MC_DIR/.next/standalone/server.js" ]]; then
  exec /bin/bash "$MC_DIR/scripts/start-standalone.sh"
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "error: node binary not found in PATH" >&2
  exit 1
fi

exec "$NODE_BIN" "$NEXT_BIN" start -p "$PORT_VALUE" -H "$BIND_HOST"
