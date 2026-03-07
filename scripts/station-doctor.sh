#!/usr/bin/env bash
# Mission Control Station Doctor
# Local diagnostics — no auth required, runs on the host.
#
# Usage: bash scripts/station-doctor.sh [--port PORT]

set -euo pipefail

MC_PORT="${1:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse args
for arg in "$@"; do
  case "$arg" in
    --port) shift; MC_PORT="$1"; shift ;;
  esac
done

PASS=0
WARN=0
FAIL=0

pass() { echo "  [PASS] $1"; ((PASS++)); }
warn() { echo "  [WARN] $1"; ((WARN++)); }
fail() { echo "  [FAIL] $1"; ((FAIL++)); }
info() { echo "  [INFO] $1"; }

echo "=== Mission Control Station Doctor ==="
echo ""

# ── 1. Process / Container check ─────────────────────────────────────────────
echo "--- Service Status ---"

RUNNING_IN_DOCKER=false
if command -v docker &>/dev/null; then
  if docker ps --filter name=mission-control --format '{{.Names}}' 2>/dev/null | grep -q mission-control; then
    RUNNING_IN_DOCKER=true
    health=$(docker inspect mission-control --format '{{.State.Health.Status}}' 2>/dev/null || echo "none")
    if [[ "$health" == "healthy" ]]; then
      pass "Docker container is healthy"
    elif [[ "$health" == "starting" ]]; then
      warn "Docker container is starting"
    else
      fail "Docker container health: $health"
    fi
  fi
fi

if ! $RUNNING_IN_DOCKER; then
  if pgrep -f "node.*server.js" &>/dev/null || pgrep -f "next-server" &>/dev/null; then
    pass "Mission Control process is running"
  else
    fail "Mission Control process not found"
  fi
fi

# ── 2. Port check ────────────────────────────────────────────────────────────
echo ""
echo "--- Network ---"

if curl -sf "http://localhost:$MC_PORT/login" &>/dev/null; then
  pass "Port $MC_PORT is responding"
else
  fail "Port $MC_PORT is not responding"
fi

# ── 3. API health ─────────────────────────────────────────────────────────────
# Try unauthenticated — will get 401 but proves the server is up
http_code=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$MC_PORT/api/status?action=health" 2>/dev/null || echo "000")
if [[ "$http_code" == "200" ]]; then
  pass "Health API responding (200)"
elif [[ "$http_code" == "401" ]]; then
  pass "Health API responding (auth required — expected)"
elif [[ "$http_code" == "000" ]]; then
  fail "Health API not reachable"
else
  warn "Health API returned HTTP $http_code"
fi

# ── 4. Disk space ─────────────────────────────────────────────────────────────
echo ""
echo "--- Disk ---"

usage_pct=$(df -h "$PROJECT_ROOT" 2>/dev/null | tail -1 | awk '{for(i=1;i<=NF;i++) if($i ~ /%/) print $i}' | tr -d '%')
if [[ -n "$usage_pct" ]]; then
  if [[ "$usage_pct" -lt 85 ]]; then
    pass "Disk usage: ${usage_pct}%"
  elif [[ "$usage_pct" -lt 95 ]]; then
    warn "Disk usage: ${usage_pct}% (getting full)"
  else
    fail "Disk usage: ${usage_pct}% (critical)"
  fi
fi

# ── 5. Database integrity ────────────────────────────────────────────────────
echo ""
echo "--- Database ---"

DB_PATH="$PROJECT_ROOT/.data/mission-control.db"
if [[ -f "$DB_PATH" ]]; then
  db_size=$(du -h "$DB_PATH" 2>/dev/null | cut -f1)
  pass "Database exists ($db_size)"

  # SQLite integrity check
  if command -v sqlite3 &>/dev/null; then
    integrity=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
    if [[ "$integrity" == "ok" ]]; then
      pass "Database integrity check passed"
    else
      fail "Database integrity check failed: $integrity"
    fi

    # WAL mode check
    journal=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode;" 2>/dev/null || echo "unknown")
    if [[ "$journal" == "wal" ]]; then
      pass "WAL mode enabled"
    else
      warn "Journal mode: $journal (WAL recommended)"
    fi
  else
    info "sqlite3 not found — skipping integrity check"
  fi
else
  if $RUNNING_IN_DOCKER; then
    info "Database is inside Docker volume (cannot check directly)"
  else
    warn "Database not found at $DB_PATH"
  fi
fi

# ── 6. Backup age ────────────────────────────────────────────────────────────
echo ""
echo "--- Backups ---"

BACKUP_DIR="$PROJECT_ROOT/.data/backups"
if [[ -d "$BACKUP_DIR" ]]; then
  latest_backup=$(find "$BACKUP_DIR" -name "*.db" -type f 2>/dev/null | sort -r | head -1)
  if [[ -n "$latest_backup" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      backup_age_days=$(( ($(date +%s) - $(stat -f %m "$latest_backup")) / 86400 ))
    else
      backup_age_days=$(( ($(date +%s) - $(stat -c %Y "$latest_backup")) / 86400 ))
    fi
    backup_name=$(basename "$latest_backup")
    if [[ "$backup_age_days" -lt 1 ]]; then
      pass "Latest backup: $backup_name (today)"
    elif [[ "$backup_age_days" -lt 7 ]]; then
      pass "Latest backup: $backup_name (${backup_age_days}d ago)"
    elif [[ "$backup_age_days" -lt 30 ]]; then
      warn "Latest backup: $backup_name (${backup_age_days}d ago — consider more frequent backups)"
    else
      fail "Latest backup: $backup_name (${backup_age_days}d ago — stale!)"
    fi
  else
    warn "No backups found in $BACKUP_DIR"
  fi
else
  warn "No backup directory at $BACKUP_DIR"
fi

# ── 7. OpenClaw gateway ─────────────────────────────────────────────────────
echo ""
echo "--- OpenClaw Gateway ---"

GW_HOST="${OPENCLAW_GATEWAY_HOST:-127.0.0.1}"
GW_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

if nc -z "$GW_HOST" "$GW_PORT" 2>/dev/null || (echo > "/dev/tcp/$GW_HOST/$GW_PORT") 2>/dev/null; then
  pass "Gateway reachable at $GW_HOST:$GW_PORT"
else
  info "Gateway not reachable at $GW_HOST:$GW_PORT"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
TOTAL=$((PASS + WARN + FAIL))
echo "=== Results: $PASS passed, $WARN warnings, $FAIL failures (of $TOTAL checks) ==="

if [[ $FAIL -gt 0 ]]; then
  echo "Status: UNHEALTHY"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo "Status: DEGRADED"
  exit 0
else
  echo "Status: HEALTHY"
  exit 0
fi
