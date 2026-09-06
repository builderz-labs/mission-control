#!/usr/bin/env bash
set -euo pipefail
if [[ "${MC_FLY_TRANSPORT:-polled}" != "polled" ]]; then
  echo 'Mission Control worker requires the polled transport' >&2
  exit 64
fi
exec node /opt/mc-worker/polled.mjs


