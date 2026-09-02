#!/bin/bash
# Unzip the cached Electron runtime. Official extract-zip leaves dist incomplete.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="${ROOT}/node_modules/electron"
DIST="${ELECTRON}/dist"
BIN="${DIST}/Electron.app/Contents/MacOS/Electron"
PATH_TXT="${ELECTRON}/path.txt"
RELPATH="Electron.app/Contents/MacOS/Electron"

write_path() {
  # Electron reads path.txt without trimming; do not write a newline.
  printf '%s' "${RELPATH}" > "${PATH_TXT}"
}

if [[ -x "${BIN}" ]]; then
  write_path
  exit 0
fi

if [[ ! -f "${ELECTRON}/install.js" ]]; then
  echo "install-runtime: electron package missing; run npm install" >&2
  exit 1
fi

(cd "${ROOT}" && node "${ELECTRON}/install.js") || true

ZIP="$(ls -1 "${HOME}/Library/Caches/electron/"*/electron-v*-darwin-*.zip 2>/dev/null | tail -1 || true)"
if [[ -z "${ZIP}" || ! -f "${ZIP}" ]]; then
  echo "install-runtime: electron zip missing from cache" >&2
  exit 1
fi

mkdir -p "${DIST}"
/usr/bin/unzip -qo "${ZIP}" -d "${DIST}"
write_path
if [[ ! -x "${BIN}" ]]; then
  echo "install-runtime: Electron binary missing after unzip" >&2
  exit 1
fi
echo "install-runtime: ${BIN}"
