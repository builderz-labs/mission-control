#!/usr/bin/env bash
# ============================================================
# JARVIS — One-command launcher
# Usage:  bash start.sh          (port from .env, default 9000)
#         bash start.sh 8080     (override port)
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'; BOLD='\033[1m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Load .env
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

PORT="${1:-${JARVIS_PORT:-8340}}"

# ── Sanity checks ─────────────────────────────────────────────────────────
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo -e "${YELLOW}⚠${NC}  ANTHROPIC_API_KEY is not set."
  echo "   Run 'bash setup.sh' first to configure JARVIS."
  exit 1
fi

# ── Build frontend if dist/ is missing ────────────────────────────────────
FRONTEND_DIST="$SCRIPT_DIR/frontend/dist"
if [[ ! -d "$FRONTEND_DIST" ]]; then
  echo -e "${YELLOW}▸${NC}  Frontend not built — building now..."
  FRONTEND_DIR="$SCRIPT_DIR/frontend"
  if command -v node &>/dev/null; then
    cd "$FRONTEND_DIR"
    if command -v pnpm &>/dev/null; then
      pnpm run build --silent
    else
      npm run build --silent
    fi
    cd "$SCRIPT_DIR"
    echo "  ✓ Frontend built."
  else
    echo "  ✗ node not found. Install Node 18+ or run: cd frontend && npm run build"
    exit 1
  fi
fi

# ── Activate venv ─────────────────────────────────────────────────────────
if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# ── Launch ────────────────────────────────────────────────────────────────
echo -e "\n${CYAN}${BOLD}JARVIS${NC} is starting on port ${BOLD}${PORT}${NC}"
echo "  Open: http://localhost:${PORT}"
echo "  Stop: Ctrl-C"
echo ""

exec python3 server.py --port "$PORT"
