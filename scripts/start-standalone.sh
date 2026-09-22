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

# Next.js standalone server reads HOSTNAME to decide bind address.
#
# HOSTNAME is almost always already exported by the login shell to the machine's
# hostname, so `"${HOSTNAME:-0.0.0.0}"` never falls back and Next.js binds to
# whatever that name resolves to. On hosts where /etc/hosts maps the hostname to
# the 127.0.1.1 alias (Debian/Ubuntu default), the server comes up listening on
# 127.0.1.1 only and is unreachable via localhost/127.0.0.1 — curl returns
# "connection refused" (HTTP 000) even though the process is alive.
#
# Default to 0.0.0.0, and let operators override the bind address explicitly
# with MC_BIND_HOST.
export HOSTNAME="${MC_BIND_HOST:-0.0.0.0}"
exec node server.js
