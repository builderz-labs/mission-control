#!/bin/bash
# Copy the production Next standalone + a Node runtime into the .app.
set -euo pipefail
DEST="${1:?bundle-ui: destination Resources/app directory}"
MC_ROOT="${MC_ROOT:-${HOME}/Dev/mission-control}"
WT="${MC_ROOT}/.claude/worktrees/desktop-bundle"
if [[ -f "${WT}/.next/standalone/server.js" ]]; then
  SRC="${WT}/.next/standalone"
  STATIC="${WT}/.next/static"
  PUBLIC="${WT}/public"
  MESSAGES="${WT}/messages"
else
  SRC="${MC_ROOT}/.next/standalone"
  STATIC="${MC_ROOT}/.next/static"
  PUBLIC="${MC_ROOT}/public"
  MESSAGES="${MC_ROOT}/messages"
fi
if [[ ! -f "${SRC}/server.js" ]]; then
  echo "bundle-ui: missing ${SRC}/server.js — run pnpm build in mission-control" >&2
  exit 1
fi

rm -rf "${DEST}/server"
ditto "${SRC}" "${DEST}/server"
if [[ -d "${STATIC}" ]]; then
  rm -rf "${DEST}/server/.next/static"
  ditto "${STATIC}" "${DEST}/server/.next/static"
fi
if [[ -d "${PUBLIC}" ]]; then
  rm -rf "${DEST}/server/public"
  ditto "${PUBLIC}" "${DEST}/server/public"
fi
if [[ -d "${MESSAGES}" ]]; then
  rm -rf "${DEST}/server/messages"
  ditto "${MESSAGES}" "${DEST}/server/messages"
fi

NODE_SRC="${MC_NODE_BIN:-$(command -v node)}"
if [[ ! -x "${NODE_SRC}" ]]; then
  echo "bundle-ui: node binary missing" >&2
  exit 1
fi
mkdir -p "${DEST}/runtime"
cp "${NODE_SRC}" "${DEST}/runtime/node"
chmod +x "${DEST}/runtime/node"
echo "bundle-ui: server=$(cat "${DEST}/server/.next/BUILD_ID" 2>/dev/null || echo unknown) node=${NODE_SRC}"
