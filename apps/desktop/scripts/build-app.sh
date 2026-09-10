#!/bin/bash
set -euo pipefail
DESKTOP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "${DESKTOP_ROOT}/scripts/build-app.mjs" "$@"
