#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

# Use project .data so DB and state match pnpm start / dev (standalone cwd is .next/standalone)
export MISSION_CONTROL_DATA_DIR="${MISSION_CONTROL_DATA_DIR:-$PROJECT_ROOT/.data}"
mkdir -p "$MISSION_CONTROL_DATA_DIR"

# Rebuild better-sqlite3 for current Node and sync into standalone (standalone's copy is from build Node and may be ABI-mismatched)
BS3_PROJECT="$PROJECT_ROOT/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3"
BS3_STANDALONE="$STANDALONE_DIR/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3"
if [[ -d "$BS3_PROJECT" && -d "$BS3_STANDALONE" ]]; then
  (cd "$PROJECT_ROOT" && pnpm rebuild better-sqlite3) 2>/dev/null || true
  if [[ -f "$BS3_PROJECT/build/Release/better_sqlite3.node" ]]; then
    mkdir -p "$BS3_STANDALONE/build/Release"
    cp -f "$BS3_PROJECT/build/Release/better_sqlite3.node" "$BS3_STANDALONE/build/Release/better_sqlite3.node" 2>/dev/null || true
  fi
fi

cd "$STANDALONE_DIR"
exec node server.js
