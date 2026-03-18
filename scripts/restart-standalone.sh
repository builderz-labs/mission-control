#!/usr/bin/env bash
# Stop any running Mission Control standalone server, then start it again.
# Usage: ./scripts/restart-standalone.sh   or: pnpm run restart:standalone

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3000}"

echo "Stopping Mission Control (port $PORT)..."
pid=$(lsof -ti:"$PORT" 2>/dev/null || true)
if [[ -n "$pid" ]]; then
  kill $pid 2>/dev/null || true
  sleep 2
  # force kill if still running
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  echo "Stopped."
else
  echo "Nothing running on port $PORT."
fi

echo "Starting Mission Control..."
exec bash "$SCRIPT_DIR/start-standalone.sh"
