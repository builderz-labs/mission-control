#!/usr/bin/env bash
#
# Install Mission Control's self-healing + monitoring timers on the VPS.
# Idempotent: safe to re-run. Creates systemd units for:
#   * mc-watchdog   — every 5 min: heal container / checkpoint WAL
#   * mc-drift-check — daily: alert if deployed != committed main
#   * mc-digest     — daily 07:05 UTC: throughput/failure digest
#
# Optional alerting: drop SLACK_WEBHOOK_URL (and any MC_PORT override) into
# /opt/mc-ops/ops.env — units load it automatically. No secrets are stored here.
#
set -euo pipefail

REPO_DIR="${MC_REPO_DIR:-/opt/mission-control}"
OPS_DIR="/opt/mc-ops"
SCRIPTS="${REPO_DIR}/scripts"

mkdir -p "$OPS_DIR"
chmod +x "${SCRIPTS}/mc-watchdog.sh" "${SCRIPTS}/mc-drift-check.sh" "${SCRIPTS}/mc-digest.sh" 2>/dev/null || true

# Optional env file for operator-supplied secrets (created empty if absent).
[ -f "${OPS_DIR}/ops.env" ] || cat > "${OPS_DIR}/ops.env" <<'ENV'
# Mission Control ops env — optional. Fill in to enable Slack alerts.
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
# MC_PORT=4000
# MC_WAL_MAX_MB=256
ENV

write_unit() { # $1=path  $2=heredoc content via stdin
  cat > "$1"
}

write_unit /etc/systemd/system/mc-watchdog.service <<EOF
[Unit]
Description=Mission Control self-healing watchdog
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${OPS_DIR}/ops.env
ExecStart=${SCRIPTS}/mc-watchdog.sh
EOF

write_unit /etc/systemd/system/mc-watchdog.timer <<EOF
[Unit]
Description=Run MC watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF

write_unit /etc/systemd/system/mc-drift-check.service <<EOF
[Unit]
Description=Mission Control deploy/git drift check
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${OPS_DIR}/ops.env
ExecStart=${SCRIPTS}/mc-drift-check.sh
EOF

write_unit /etc/systemd/system/mc-drift-check.timer <<EOF
[Unit]
Description=Run MC drift check daily

[Timer]
OnCalendar=*-*-* 06:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

write_unit /etc/systemd/system/mc-digest.service <<EOF
[Unit]
Description=Mission Control daily throughput/failure digest
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${OPS_DIR}/ops.env
ExecStart=${SCRIPTS}/mc-digest.sh
EOF

write_unit /etc/systemd/system/mc-digest.timer <<EOF
[Unit]
Description=Run MC digest daily

[Timer]
OnCalendar=*-*-* 07:05:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now mc-watchdog.timer mc-drift-check.timer mc-digest.timer

echo "✓ Installed + enabled timers:"
systemctl list-timers 'mc-*' --no-pager || true
echo "✓ Running one watchdog pass now:"
systemctl start mc-watchdog.service && tail -n 5 "${OPS_DIR}/watchdog.log" 2>/dev/null || true
