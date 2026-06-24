#!/usr/bin/env bash
#
# Self-healing watchdog for Mission Control (runs on the VPS via systemd timer).
# Every few minutes it verifies the container is healthy and the SQLite WAL is
# bounded, then heals what it can:
#   * container not running        → recreate via docker compose
#   * HTTP not responding (5xx/000)→ restart container (one grace retry first)
#   * WAL file oversized           → checkpoint(TRUNCATE) inside the container
# Every action is logged and (if SLACK_WEBHOOK_URL is set) posted to Slack.
# No secrets are baked in — Slack alerting is opt-in via env only.
#
# Exit code is always 0 (fail-soft): a watchdog must never crash-loop a timer.
#
set -uo pipefail

PROJECT="mission-control"
CONTAINER="mission-control"
COMPOSE_DIR="${MC_REPO_DIR:-/opt/mission-control}"
HEALTH_URL="http://127.0.0.1:${MC_PORT:-4000}/"
WAL_MAX_MB="${MC_WAL_MAX_MB:-256}"
LOG="${MC_OPS_LOG:-/opt/mc-ops/watchdog.log}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

alert() {
  local msg="$1"
  log "ALERT: $msg"
  if [ -n "$SLACK_WEBHOOK_URL" ]; then
    curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
      --data "{\"text\":\"🛟 MC watchdog: ${msg}\"}" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 \
      || log "slack post failed"
  fi
}

compose() {
  docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.override.yml "$@"
}

restart() {
  local reason="$1"
  log "healing: recreating container (reason: ${reason})"
  ( cd "$COMPOSE_DIR" && compose up -d >>"$LOG" 2>&1 )
  alert "restarted MC container — reason: ${reason}"
}

# ── 1. container running? ────────────────────────────────────────────────────
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
if [ "$state" != "running" ]; then
  restart "container state=${state}"
  exit 0
fi

# ── 2. HTTP responding? (/ returns 307 when healthy; only 000/5xx are bad) ────
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
  sleep 5
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
    restart "http=${code}"
    exit 0
  fi
fi

# ── 3. WAL size guard (safety net beyond wal_autocheckpoint) ──────────────────
mount="$(docker volume inspect "${PROJECT}_mc-data" -f '{{.Mountpoint}}' 2>/dev/null || echo '')"
wal="${mount}/mission-control.db-wal"
if [ -n "$mount" ] && [ -f "$wal" ]; then
  size_mb=$(( $(stat -c %s "$wal" 2>/dev/null || echo 0) / 1048576 ))
  if [ "$size_mb" -ge "$WAL_MAX_MB" ]; then
    log "WAL is ${size_mb}MB (>= ${WAL_MAX_MB}MB) — running checkpoint(TRUNCATE)"
    docker exec "$CONTAINER" node -e "const D=require('better-sqlite3');const d=new D('/app/.data/mission-control.db');d.pragma('wal_checkpoint(TRUNCATE)');d.close()" >>"$LOG" 2>&1 \
      && log "checkpoint done" \
      || alert "WAL checkpoint failed at ${size_mb}MB"
  fi
fi

# Healthy tick — keep a heartbeat line (rotated by size below).
log "ok: state=running http=${code} wal=${size_mb:-?}MB"

# Trim the log to the last 2000 lines so it never grows unbounded.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -n 1000 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi

exit 0
