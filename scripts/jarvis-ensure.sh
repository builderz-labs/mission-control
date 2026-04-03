#!/usr/bin/env bash
# jarvis-ensure.sh
#
# Ensures Jarvis backend is running before Next.js starts.
# Called automatically by `pnpm dev` — no manual steps required.
#
# Flow:
#   1. Check if Jarvis is already healthy
#   2. If not, start it using the .venv Python interpreter
#   3. Wait up to 30 seconds for it to come online
#   4. Sync the auth token to .env (so NEXT_PUBLIC_ vars are current)

set -e

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/jarvis"
HEALTH_URL="http://localhost:8340/api/health"
VENV_PYTHON="$JARVIS_DIR/.venv/bin/python"
FALLBACK_PYTHON="python3"
LOG_FILE="/tmp/jarvis-server.log"

echo "[jarvis-ensure] Checking Jarvis backend..."

# ── 1. Health check ──────────────────────────────────────────────────────────

is_healthy() {
  curl -sf "$HEALTH_URL" >/dev/null 2>&1
}

if is_healthy; then
  echo "[jarvis-ensure] Jarvis already running — skipping start."
else
  # ── 2. Pick Python interpreter ─────────────────────────────────────────────
  if [ -f "$VENV_PYTHON" ]; then
    PYTHON="$VENV_PYTHON"
  else
    PYTHON="$FALLBACK_PYTHON"
  fi

  echo "[jarvis-ensure] Starting Jarvis with $PYTHON..."
  cd "$JARVIS_DIR"
  nohup "$PYTHON" server.py --host localhost --port 8340 >"$LOG_FILE" 2>&1 &
  JARVIS_PID=$!
  echo "[jarvis-ensure] Jarvis PID: $JARVIS_PID (logs: $LOG_FILE)"

  # ── 3. Wait for health ─────────────────────────────────────────────────────
  echo "[jarvis-ensure] Waiting for Jarvis to come online..."
  for i in $(seq 1 30); do
    if is_healthy; then
      echo "[jarvis-ensure] Jarvis is online (${i}s)."
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "[jarvis-ensure] WARNING: Jarvis did not start within 30s. Check $LOG_FILE"
      echo "[jarvis-ensure] Continuing anyway — Ultron will show orb in disconnected state."
      exit 0
    fi
    sleep 1
  done
fi

# ── 4. Sync auth token to .env ────────────────────────────────────────────────
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "[jarvis-ensure] Syncing auth token..."
node scripts/jarvis-sync-token.mjs

echo "[jarvis-ensure] Done. Jarvis is ready."
