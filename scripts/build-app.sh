#!/bin/bash
# Install ~/Applications/Mission Control.app wrapping localhost:3000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "${ROOT}/scripts/install-runtime.sh"
APP="${MISSION_CONTROL_APP:-${HOME}/Applications/Mission Control.app}"
RUNTIME="${ROOT}/node_modules/electron/dist/Electron.app"
STAMP="$(/usr/bin/shasum -a 256 "${ROOT}/package.json" "${ROOT}/src/"*.mjs \
  | /usr/bin/awk '{print $1}' | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

if [[ -x "${APP}/Contents/MacOS/Electron" \
  && -f "${APP}/Contents/Resources/app/.stamp" \
  && "$(cat "${APP}/Contents/Resources/app/.stamp")" == "${STAMP}" ]]; then
  echo "build-app: up to date"
  exit 0
fi

if [[ ! -d "${RUNTIME}" ]]; then
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
for src in "${ROOT}/src/"*.mjs; do
  case "${src}" in *.test.mjs) continue ;; esac
  cp "${src}" "${RES}/src/"
done
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
echo "build-app: installed ${APP}"
