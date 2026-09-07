#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$PROJECT_ROOT/scripts/load-env.sh"
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
STANDALONE_STATIC_DIR="$STANDALONE_NEXT_DIR/static"
SOURCE_STATIC_DIR="$PROJECT_ROOT/.next/static"
SOURCE_PUBLIC_DIR="$PROJECT_ROOT/public"
STANDALONE_PUBLIC_DIR="$STANDALONE_DIR/public"

if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "error: standalone server missing at $STANDALONE_DIR/server.js" >&2
  echo "run 'pnpm build' first" >&2
  exit 1
fi

mkdir -p "$STANDALONE_NEXT_DIR"

if [[ -d "$SOURCE_STATIC_DIR" ]]; then
  rm -rf "$STANDALONE_STATIC_DIR"
  cp -R "$SOURCE_STATIC_DIR" "$STANDALONE_STATIC_DIR"
fi

if [[ -d "$SOURCE_PUBLIC_DIR" ]]; then
  rm -rf "$STANDALONE_PUBLIC_DIR"
  cp -R "$SOURCE_PUBLIC_DIR" "$STANDALONE_PUBLIC_DIR"
fi

cd "$STANDALONE_DIR"

# Load .env as literal configuration if it exists (consistent with Docker).
# NEXT_PUBLIC_* vars are already baked into the bundle at build time,
# but server-side vars (AUTH_*, OPENCLAW_*, etc.) need this to take effect.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  load_env_file "$PROJECT_ROOT/.env"
fi

export MISSION_CONTROL_DATA_DIR="${MISSION_CONTROL_DATA_DIR:-$PROJECT_ROOT/.data}"

# `launchctl kickstart -k` replaces the doppler wrapper but not the node server
# doppler forked from it: that server survives, reparented to PID 1, and keeps
# polling this database with the build it was started from. Two builds sharing
# one durable queue mis-attribute rows, so reap a prior controller before
# binding. Match on the standalone working directory to leave development
# servers and database clients alone.
reap_previous_controller() {
  command -v lsof >/dev/null 2>&1 || return 0
  local db="$MISSION_CONTROL_DATA_DIR/mission-control.db"
  [[ -f "$db" ]] || return 0
  local pid cwd
  for pid in $(lsof -t "$db" 2>/dev/null || true); do
    [[ "$pid" == "$$" ]] && continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
    [[ "$cwd" == "$STANDALONE_DIR" ]] || continue
    echo "reaping previous controller pid $pid" >&2
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  done
}

reap_previous_controller

# Next.js standalone server reads HOSTNAME to decide bind address.
# Default to 0.0.0.0 so the server is accessible from outside the host.
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
# Next.js overwrites argv[0] with `next-server (vX.Y.Z)`. A bare `node server.js`
# argv is shorter than that title, so the write runs past the end of the argv
# region and `ps` keeps reading into the adjacent environment block, printing
# API_KEY and every other secret to any local user. Reserving a longer argv[0]
# keeps the title inside its own region. Must stay longer than the Next title.
export MC_PROCESS_NAME="mission-control-standalone-server"
# Load Doppler last so approved values override local dotenv defaults.
# Keep disabled until the launchd identity passes a no-fallback preflight.
if [[ "${MC_USE_DOPPLER:-0}" == "1" ]]; then
  if ! command -v doppler >/dev/null 2>&1; then
    echo "error: Doppler CLI is required when MC_USE_DOPPLER=1" >&2
    exit 1
  fi
  exec doppler run --project mission-control --config prd --no-fallback -- \
    bash -c 'exec -a "${MC_PROCESS_NAME}" node server.js'
fi
exec -a "${MC_PROCESS_NAME}" node server.js
