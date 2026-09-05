#!/bin/bash
# Install a self-contained ~/Applications/Mission Control.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MC_ROOT="${MC_ROOT:-${HOME}/Dev/mission-control}"
WT="${MC_ROOT}/.claude/worktrees/desktop-bundle"
bash "${ROOT}/scripts/install-runtime.sh" || true
APP="${MISSION_CONTROL_APP:-${HOME}/Applications/Mission Control.app}"
RUNTIME="${ROOT}/node_modules/electron/dist/Electron.app"
UI_ID="$(cat "${WT}/.next/standalone/.next/BUILD_ID" 2>/dev/null \
  || cat "${MC_ROOT}/.next/standalone/.next/BUILD_ID" 2>/dev/null \
  || echo none)"
STAMP="$(printf '%s\n' "${UI_ID}" \
  | cat - "${ROOT}/package.json" "${ROOT}/scripts/bundle-ui.sh" "${ROOT}/src/"*.mjs "${ROOT}/src/shell.html" \
  | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

if [[ -x "${APP}/Contents/MacOS/Electron" \
  && -f "${APP}/Contents/Resources/app/.stamp" \
  && -f "${APP}/Contents/Resources/app/server/server.js" \
  && -x "${APP}/Contents/Resources/app/runtime/node" \
  && "$(cat "${APP}/Contents/Resources/app/.stamp")" == "${STAMP}" ]]; then
  echo "build-app: up to date"
  exit 0
fi

if [[ ! -x "${RUNTIME}/Contents/MacOS/Electron" \
  && -x "${APP}/Contents/MacOS/Electron" ]]; then
  echo "build-app: using installed Electron runtime"
  RUNTIME="${APP}"
fi
if [[ ! -x "${RUNTIME}/Contents/MacOS/Electron" ]]; then
  echo "build-app: Electron.app missing" >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/mc-app.XXXXXX")"
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT
BUNDLE="${TMP}/Mission Control.app"
ditto "${RUNTIME}" "${BUNDLE}"
RES="${BUNDLE}/Contents/Resources/app"
mkdir -p "${RES}/src"
cp "${ROOT}/package.json" "${RES}/"
cp "${ROOT}/src/shell.html" "${RES}/src/"
for src in "${ROOT}/src/"*.mjs; do
  case "${src}" in *.test.mjs) continue ;; esac
  cp "${src}" "${RES}/src/"
done
bash "${ROOT}/scripts/bundle-ui.sh" "${RES}"
printf '%s' "${STAMP}" > "${RES}/.stamp"

PLIST="${BUNDLE}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Mission Control" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.tylerdevries.mission-control-desktop" "${PLIST}"
if ! /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Mission Control" "${PLIST}"; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Mission Control" "${PLIST}"
fi
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "${PLIST}" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "${PLIST}" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSAllowsLocalNetworking true" "${PLIST}"

mkdir -p "$(dirname "${APP}")"
rm -rf "${APP}"
ditto "${BUNDLE}" "${APP}"
codesign --force --deep -s - "${APP}" >/dev/null 2>&1 || true
xattr -dr com.apple.quarantine "${APP}" 2>/dev/null || true
ZIP="${MISSION_CONTROL_ZIP:-${HOME}/Applications/Mission Control.zip}"
rm -f "${ZIP}"
ditto -c -k --keepParent "${APP}" "${ZIP}"
echo "build-app: installed ${APP}"
echo "build-app: zip ${ZIP}"
