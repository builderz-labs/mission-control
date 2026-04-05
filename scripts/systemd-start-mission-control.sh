#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_DIR="${NVM_DIR:-/home/$(whoami)/.nvm}"
NVM_SH="$NODE_DIR/nvm.sh"
NVM_VERSION_FILE="$PROJECT_ROOT/.nvmrc"
PNPM_CMD=""

if [[ -s "$NVM_SH" ]]; then
  # shellcheck disable=SC1090
  source "$NVM_SH"
fi

if [[ -f "$NVM_VERSION_FILE" ]]; then
  NODE_VERSION="$(tr -d '[:space:]' < "$NVM_VERSION_FILE")"
  if [[ -n "$NODE_VERSION" ]]; then
    shopt -s nullglob
    for candidate in "$NODE_DIR/versions/node"/"v${NODE_VERSION}"*; do
      if [[ -x "$candidate/bin/pnpm" ]]; then
        PNPM_CMD="$candidate/bin/pnpm"
        break
      fi
    done
    shopt -u nullglob
  fi
fi

if [[ -z "$PNPM_CMD" ]]; then
  PNPM_CMD="$(command -v pnpm 2>/dev/null || true)"
fi

if [[ -z "$PNPM_CMD" ]]; then
  shopt -s nullglob
  for candidate in "$NODE_DIR/versions/node"/v*/bin/pnpm; do
    if [[ -x "$candidate" ]]; then
      PNPM_CMD="$candidate"
      break
    fi
  done
  shopt -u nullglob
fi

if [[ -z "$PNPM_CMD" ]]; then
  echo "error: pnpm executable not found" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
exec "$PNPM_CMD" start:standalone
