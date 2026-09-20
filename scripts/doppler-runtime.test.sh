#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="$ROOT_DIR/scripts/start-standalone.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

grep -q 'MC_DOPPLER_PROJECT and MC_DOPPLER_CONFIG are required' "$START_SCRIPT" \
  || fail 'Doppler runtime selection is not fail-closed'
grep -q -- '--project "${MC_DOPPLER_PROJECT}"' "$START_SCRIPT" \
  || fail 'Doppler project is not selected from the runtime interface'
grep -q -- '--config "${MC_DOPPLER_CONFIG}"' "$START_SCRIPT" \
  || fail 'Doppler config is not selected from the runtime interface'
if grep -q -- '--project mission-control --config prd' "$START_SCRIPT"; then
  fail 'legacy Doppler destination remains hardcoded'
fi
grep -q -- '--no-fallback' "$START_SCRIPT" \
  || fail 'Doppler runtime no longer fails closed'

echo 'doppler runtime contract: ok'
