#!/usr/bin/env bash
#
# Drift detector for Mission Control (runs on the VPS via a daily systemd timer).
# Guards against the exact failure that started all this: the deployed artifact
# silently diverging from a committed git ref, or being built from a dirty tree.
#
# Reports (log + optional Slack) when ANY of these is true:
#   * .deployed-sha != origin/main   (running something not on main)
#   * the working tree has uncommitted tracked/staged changes
#   * .deployed-sha is missing       (provenance unknown)
#
# Fail-soft: always exits 0.
#
set -uo pipefail

COMPOSE_DIR="${MC_REPO_DIR:-/opt/mission-control}"
LOG="${MC_OPS_LOG_DIR:-/opt/mc-ops}/drift-check.log"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }
alert() {
  log "DRIFT: $1"
  [ -n "$SLACK_WEBHOOK_URL" ] && curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"⚠️ MC drift: $1\"}" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
}

cd "$COMPOSE_DIR" || { log "ERROR: cannot cd $COMPOSE_DIR"; exit 0; }
git fetch origin --quiet 2>/dev/null || { log "WARN: git fetch failed"; }

origin="$(git rev-parse origin/main 2>/dev/null || echo unknown)"
deployed="$(cat .deployed-sha 2>/dev/null || echo missing)"

problems=""
[ "$deployed" = "missing" ] && problems="no .deployed-sha (provenance unknown)"
if [ "$deployed" != "missing" ] && [ "$deployed" != "$origin" ]; then
  problems="${problems:+$problems; }deployed(${deployed:0:9}) != origin/main(${origin:0:9})"
fi
git diff --quiet 2>/dev/null    || problems="${problems:+$problems; }working tree has unstaged edits"
git diff --cached --quiet 2>/dev/null || problems="${problems:+$problems; }index has staged edits"

if [ -n "$problems" ]; then
  alert "$problems"
else
  log "ok: deployed==origin/main(${origin:0:9}), tree clean"
fi
exit 0
