#!/bin/bash
# Mission Control start script for LaunchAgent
# Self-healing: rebuilds if artifacts are missing, handles port conflicts
set -euo pipefail

MC_DIR="/Users/frankmclaughlin/Projects/mission-control-builderz"
LOG_DIR="$HOME/Developer/clawd/logs"
LOG_FILE="$LOG_DIR/mission-control-startup.log"
LOCK_FILE="/tmp/mc-build.lock"
PORT=3100

mkdir -p "$LOG_DIR"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [start-mc] $1" >> "$LOG_FILE"
  echo "$1"
}

log "=== Mission Control startup (PID $$) ==="

cd "$MC_DIR"

# Source .env (export all vars)
if [ -f .env ]; then
  set -a
  source .env
  set +a
  log "Loaded .env"
else
  log "WARNING: .env file not found"
fi

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# --- Lock: prevent concurrent builds from launchd restarts ---
needs_build=false
if [ ! -d node_modules ] || [ ! -d node_modules/.pnpm ]; then
  needs_build=true
fi
if [ ! -d .next/standalone ] || [ ! -f .next/standalone/server.js ]; then
  needs_build=true
fi

if [ "$needs_build" = true ]; then
  # If another instance is already building, wait for it
  if [ -f "$LOCK_FILE" ]; then
    other_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$other_pid" ] && kill -0 "$other_pid" 2>/dev/null; then
      log "Build already in progress (PID $other_pid) — waiting up to 120s"
      for i in $(seq 1 24); do
        sleep 5
        if [ -f .next/standalone/server.js ]; then
          log "Build completed by other process — continuing"
          break
        fi
        if ! kill -0 "$other_pid" 2>/dev/null; then
          log "Other build process exited — taking over"
          break
        fi
      done
    fi
  fi

  # Acquire lock
  echo $$ > "$LOCK_FILE"

  # --- Self-healing: ensure dependencies exist ---
  if [ ! -d node_modules ] || [ ! -d node_modules/.pnpm ]; then
    log "node_modules missing or incomplete — running pnpm install"
    /usr/local/bin/pnpm install --frozen-lockfile 2>&1 | tail -5 >> "$LOG_FILE"
    log "pnpm install completed"
  fi

  # --- Self-healing: ensure standalone build exists ---
  if [ ! -d .next/standalone ] || [ ! -f .next/standalone/server.js ]; then
    log "CRITICAL: .next/standalone/ missing — running pnpm build"
    /usr/local/bin/pnpm build 2>&1 | tail -10 >> "$LOG_FILE"
    log "pnpm build completed"
  fi

  # Release lock
  rm -f "$LOCK_FILE"
fi

# --- Port conflict handling: kill stale processes on our port ---
stale_pid=$(/usr/bin/lsof -ti tcp:${PORT} 2>/dev/null || true)
if [ -n "$stale_pid" ]; then
  log "Port ${PORT} in use by PID(s): $stale_pid — killing"
  echo "$stale_pid" | xargs kill -9 2>/dev/null || true
  sleep 2
  log "Stale process(es) killed"
fi

# --- Copy static assets into standalone (required for Next.js standalone output) ---
if [ -d .next/static ]; then
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/static
  log "Copied .next/static into standalone"
fi
if [ -d public ]; then
  cp -r public .next/standalone/public
  log "Copied public/ into standalone"
fi

log "Starting Next.js standalone server on port ${PORT}"
exec /usr/local/bin/node .next/standalone/server.js
