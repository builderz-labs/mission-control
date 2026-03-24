#!/usr/bin/env bash
# Mission Control — One-Command Installer
# The mothership for your OpenClaw fleet.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/builderz-labs/mission-control/main/install.sh | bash
#   # or
#   bash install.sh [--docker|--local] [--port PORT] [--data-dir DIR]
#
# Installs Mission Control and optionally repairs/configures OpenClaw.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
MC_PORT="${MC_PORT:-3000}"
MC_DATA_DIR=""
DEPLOY_MODE=""
SKIP_OPENCLAW=false
REPO_URL="https://github.com/builderz-labs/mission-control.git"
INSTALL_DIR="${MC_INSTALL_DIR:-$(pwd)/mission-control}"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)       DEPLOY_MODE="docker"; shift ;;
    --local)        DEPLOY_MODE="local"; shift ;;
    --port)         MC_PORT="$2"; shift 2 ;;
    --data-dir)     MC_DATA_DIR="$2"; shift 2 ;;
    --skip-openclaw) SKIP_OPENCLAW=true; shift ;;
    --dir)          INSTALL_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: install.sh [--docker|--local] [--port PORT] [--data-dir DIR] [--dir INSTALL_DIR] [--skip-openclaw]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo -e "\033[1;34m[MC]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[!!]\033[0m $*"; }
err()   { echo -e "\033[1;31m[ERR]\033[0m $*" >&2; }
die()   { err "$*"; exit 1; }

command_exists() { command -v "$1" &>/dev/null; }

detect_os() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)      die "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             die "Unsupported architecture: $arch" ;;
  esac

  ok "Detected $OS/$ARCH"
}

check_prerequisites() {
  local has_docker=false has_node=false

  if command_exists docker && docker info &>/dev/null 2>&1; then
    has_docker=true
    ok "Docker available ($(docker --version | head -1))"
  fi

  if command_exists node; then
    local node_major
    node_major=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_major" -ge 20 ]]; then
      has_node=true
      ok "Node.js $(node -v) available"
    else
      warn "Node.js $(node -v) found but v20+ required"
    fi
  fi

  if ! $has_docker && ! $has_node; then
    die "Either Docker or Node.js 20+ is required. Install one and retry."
  fi

  # Auto-select deploy mode if not specified
  if [[ -z "$DEPLOY_MODE" ]]; then
    if $has_docker; then
      DEPLOY_MODE="docker"
      info "Auto-selected Docker deployment (use --local to override)"
    else
      DEPLOY_MODE="local"
      info "Auto-selected local deployment (Docker not available)"
    fi
  fi

  # Validate chosen mode
  if [[ "$DEPLOY_MODE" == "docker" ]] && ! $has_docker; then
    die "Docker deployment requested but Docker is not available"
  fi
  if [[ "$DEPLOY_MODE" == "local" ]] && ! $has_node; then
    die "Local deployment requested but Node.js 20+ is not available"
  fi
  if [[ "$DEPLOY_MODE" == "local" ]] && ! command_exists pnpm; then
    info "Installing pnpm via corepack..."
    corepack enable && corepack prepare pnpm@latest --activate
    ok "pnpm installed"
  fi
}

# ── Clone or update repo ─────────────────────────────────────────────────────
fetch_source() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating existing installation at $INSTALL_DIR..."
    cd "$INSTALL_DIR"
    git fetch --tags
    local latest_tag
    latest_tag=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "")
    if [[ -n "$latest_tag" ]]; then
      git checkout "$latest_tag"
      ok "Checked out $latest_tag"
    else
      git pull origin main
      ok "Updated to latest main"
    fi
  else
    info "Cloning Mission Control..."
    if command_exists git; then
      git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
      cd "$INSTALL_DIR"
      ok "Cloned to $INSTALL_DIR"
    else
      die "git is required to clone the repository"
    fi
  fi
}

# ── Generate .env ─────────────────────────────────────────────────────────────
setup_env() {
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    info "Existing .env found — keeping current configuration"
    return
  fi

  info "Generating secure .env configuration..."
  bash "$INSTALL_DIR/scripts/generate-env.sh" "$INSTALL_DIR/.env"

  # Set the port if non-default
  if [[ "$MC_PORT" != "3000" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^# PORT=3000|PORT=$MC_PORT|" "$INSTALL_DIR/.env"
    else
      sed -i "s|^# PORT=3000|PORT=$MC_PORT|" "$INSTALL_DIR/.env"
    fi
  fi

  # Auto-detect and write OpenClaw home directory into .env
  local oc_home="${OPENCLAW_HOME:-$HOME/.openclaw}"
  if [[ -d "$oc_home" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^OPENCLAW_HOME=.*|OPENCLAW_HOME=$oc_home|" "$INSTALL_DIR/.env"
    else
      sed -i "s|^OPENCLAW_HOME=.*|OPENCLAW_HOME=$oc_home|" "$INSTALL_DIR/.env"
    fi
    info "Set OPENCLAW_HOME=$oc_home in .env"
  fi

  # In Docker mode, the gateway runs on the host, not inside the container.
  # Set OPENCLAW_GATEWAY_HOST to the Docker host gateway IP so the container
  # can reach the gateway. Users may override this with the gateway container
  # name if running OpenClaw in a container on the same network.
  if [[ "$DEPLOY_MODE" == "docker" ]]; then
    local gw_host="${OPENCLAW_GATEWAY_HOST:-}"
    if [[ -z "$gw_host" ]]; then
      # Detect Docker host IP (host-gateway alias or default bridge)
      if getent hosts host-gateway &>/dev/null 2>&1; then
        gw_host="host-gateway"
      else
        # Fallback: use the default Docker bridge gateway (172.17.0.1)
        gw_host=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}' || echo "172.17.0.1")
      fi
    fi
    if [[ -n "$gw_host" && "$gw_host" != "127.0.0.1" ]]; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|^OPENCLAW_GATEWAY_HOST=.*|OPENCLAW_GATEWAY_HOST=$gw_host|" "$INSTALL_DIR/.env"
      else
        sed -i "s|^OPENCLAW_GATEWAY_HOST=.*|OPENCLAW_GATEWAY_HOST=$gw_host|" "$INSTALL_DIR/.env"
      fi
      info "Set OPENCLAW_GATEWAY_HOST=$gw_host in .env (Docker host IP)"
      info "  If your gateway runs in a Docker container, update OPENCLAW_GATEWAY_HOST"
      info "  to the container name and add it to the mc-net network."
    fi
  fi

  ok "Secure .env generated"
}

# ── Docker deployment ─────────────────────────────────────────────────────────
deploy_docker() {
  info "Starting Docker deployment..."

  export MC_PORT
  docker compose up -d --build

  # Wait for healthy
  info "Waiting for Mission Control to become healthy..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
      break
    fi
    # Fallback: try HTTP check
    if curl -sf "http://localhost:$MC_PORT/login" &>/dev/null; then
      break
    fi
    sleep 2
    ((retries--))
  done

  if [[ $retries -eq 0 ]]; then
    warn "Timeout waiting for health check — container may still be starting"
    docker compose logs --tail 20
  else
    ok "Mission Control is running in Docker"
  fi
}

# ── Local deployment ──────────────────────────────────────────────────────────
deploy_local() {
  info "Starting local deployment..."

  cd "$INSTALL_DIR"
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  pnpm rebuild better-sqlite3 2>/dev/null || true
  ok "Dependencies installed"

  info "Building Mission Control..."
  pnpm build
  ok "Build complete"

  # Create systemd service on Linux if systemctl is available
  if [[ "$OS" == "linux" ]] && command_exists systemctl; then
    setup_systemd
  fi

  info "Starting Mission Control..."
  PORT="$MC_PORT" nohup pnpm start > "$INSTALL_DIR/.data/mc.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$INSTALL_DIR/.data/mc.pid"

  sleep 3
  if kill -0 "$pid" 2>/dev/null; then
    ok "Mission Control running (PID $pid)"
  else
    err "Failed to start. Check logs: $INSTALL_DIR/.data/mc.log"
    exit 1
  fi
}

# ── Systemd service ──────────────────────────────────────────────────────────
setup_systemd() {
  local service_file="/etc/systemd/system/mission-control.service"
  if [[ -f "$service_file" ]]; then
    info "Systemd service already exists"
    return
  fi

  info "Creating systemd service..."
  local user
  user="$(whoami)"
  local node_path
  node_path="$(which node)"

  cat > /tmp/mission-control.service <<UNIT
[Unit]
Description=Mission Control - OpenClaw Agent Dashboard
After=network.target

[Service]
Type=simple
User=$user
WorkingDirectory=$INSTALL_DIR
ExecStart=$node_path $INSTALL_DIR/.next/standalone/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$MC_PORT
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
UNIT

  if [[ "$(id -u)" -eq 0 ]]; then
    mv /tmp/mission-control.service "$service_file"
    systemctl daemon-reload
    systemctl enable mission-control
    ok "Systemd service installed and enabled"
  else
    info "Run as root to install systemd service:"
    info "  sudo mv /tmp/mission-control.service $service_file"
    info "  sudo systemctl daemon-reload && sudo systemctl enable --now mission-control"
  fi
}

# ── OpenClaw fleet check ─────────────────────────────────────────────────────
check_openclaw() {
  if $SKIP_OPENCLAW; then
    info "Skipping OpenClaw checks (--skip-openclaw)"
    return
  fi

  echo ""
  info "=== OpenClaw Fleet Check ==="

  # Check if openclaw binary exists
  if command_exists openclaw; then
    local oc_version
    oc_version="$(openclaw --version 2>/dev/null || echo 'unknown')"
    ok "OpenClaw binary found: $oc_version"
  elif command_exists clawdbot; then
    local cb_version
    cb_version="$(clawdbot --version 2>/dev/null || echo 'unknown')"
    ok "ClawdBot binary found: $cb_version (legacy)"
    warn "Consider upgrading to openclaw CLI"
  else
    info "OpenClaw CLI not found — install it to enable agent orchestration"
    info "  See: https://github.com/builderz-labs/openclaw"
    return
  fi

  # Check OpenClaw home directory
  local oc_home="${OPENCLAW_HOME:-$HOME/.openclaw}"
  if [[ -d "$oc_home" ]]; then
    ok "OpenClaw home: $oc_home"

    # Check config
    local oc_config="$oc_home/openclaw.json"
    if [[ -f "$oc_config" ]]; then
      ok "Config found: $oc_config"
    else
      warn "No openclaw.json found at $oc_config"
      info "Mission Control will create a default config on first gateway connection"
    fi

    # Check for stale PID files
    local stale_count=0
    for pidfile in "$oc_home"/*.pid "$oc_home"/pids/*.pid; do
      [[ -f "$pidfile" ]] || continue
      local pid
      pid="$(cat "$pidfile" 2>/dev/null)" || continue
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$pidfile"
        ((stale_count++))
      fi
    done
    if [[ $stale_count -gt 0 ]]; then
      ok "Cleaned $stale_count stale PID file(s)"
    fi

    # Check logs directory size
    local logs_dir="$oc_home/logs"
    if [[ -d "$logs_dir" ]]; then
      local logs_size
      if [[ "$(uname)" == "Darwin" ]]; then
        logs_size="$(du -sh "$logs_dir" 2>/dev/null | cut -f1)"
      else
        logs_size="$(du -sh "$logs_dir" 2>/dev/null | cut -f1)"
      fi
      info "Logs directory: $logs_size ($logs_dir)"

      # Clean old logs (> 30 days)
      local old_logs
      old_logs=$(find "$logs_dir" -name "*.log" -mtime +30 2>/dev/null | wc -l | tr -d ' ')
      if [[ "$old_logs" -gt 0 ]]; then
        find "$logs_dir" -name "*.log" -mtime +30 -delete 2>/dev/null || true
        ok "Cleaned $old_logs log file(s) older than 30 days"
      fi
    fi

    # Check workspace directory
    local workspace="$oc_home/workspace"
    if [[ -d "$workspace" ]]; then
      local agent_count
      agent_count=$(find "$workspace" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
      ((agent_count--)) # subtract the workspace dir itself
      info "Workspace: $agent_count agent workspace(s) in $workspace"
    fi
  else
    info "OpenClaw home not found at $oc_home"
    info "Set OPENCLAW_HOME in .env to point to your OpenClaw state directory"
  fi

  # Check gateway port
  local gw_host="${OPENCLAW_GATEWAY_HOST:-127.0.0.1}"
  local gw_port="${OPENCLAW_GATEWAY_PORT:-18789}"
  if nc -z "$gw_host" "$gw_port" 2>/dev/null || (echo > "/dev/tcp/$gw_host/$gw_port") 2>/dev/null; then
    ok "Gateway reachable at $gw_host:$gw_port"
  else
    info "Gateway not reachable at $gw_host:$gw_port (start it with: openclaw gateway start)"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║   Mission Control Installer          ║"
  echo "  ║   The mothership for your fleet      ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

  detect_os
  check_prerequisites

  # If running from within an existing clone, use current dir
  if [[ -f "$(pwd)/package.json" ]] && grep -q '"mission-control"' "$(pwd)/package.json" 2>/dev/null; then
    INSTALL_DIR="$(pwd)"
    info "Running from existing clone at $INSTALL_DIR"
  else
    fetch_source
  fi

  # Ensure data directory exists
  mkdir -p "$INSTALL_DIR/.data"

  setup_env

  case "$DEPLOY_MODE" in
    docker) deploy_docker ;;
    local)  deploy_local ;;
    *)      die "Unknown deploy mode: $DEPLOY_MODE" ;;
  esac

  check_openclaw

  # ── Print summary ──
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║   Installation Complete              ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""
  info "Dashboard:  http://localhost:$MC_PORT"
  info "Mode:       $DEPLOY_MODE"
  info "Data:       $INSTALL_DIR/.data/"
  echo ""
  info "Credentials are in: $INSTALL_DIR/.env"
  echo ""

  if [[ "$DEPLOY_MODE" == "docker" ]]; then
    info "Manage:"
    info "  docker compose logs -f        # view logs"
    info "  docker compose restart         # restart"
    info "  docker compose down            # stop"
  else
    info "Manage:"
    info "  cat $INSTALL_DIR/.data/mc.log  # view logs"
    info "  kill \$(cat $INSTALL_DIR/.data/mc.pid)  # stop"
  fi

  echo ""
}

main "$@"
