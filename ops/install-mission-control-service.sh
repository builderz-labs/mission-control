#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$PROJECT_ROOT/ops/templates/mission-control@.service"
USER_NAME="${1:-${SUDO_USER:-$USER}}"
UNIT_NAME="mission-control@${USER_NAME}.service"
TARGET_PATH="/etc/systemd/system/$UNIT_NAME"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: template not found: $TEMPLATE" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "error: run as root (for example: sudo $0 ${USER_NAME})" >&2
  exit 1
fi

install -m 0644 "$TEMPLATE" "$TARGET_PATH"

if [[ -f /etc/systemd/system/mission-control.service ]]; then
  systemctl disable --now mission-control.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mission-control.service
fi

systemctl daemon-reload
systemctl enable --now "$UNIT_NAME"

echo "installed and started $UNIT_NAME"
