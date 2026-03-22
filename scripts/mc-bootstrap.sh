#!/usr/bin/env bash
set -euo pipefail

MC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
MC_PLIST="$LAUNCHD_DIR/ai.missioncontrol.plist"
RELAY_PLIST="$LAUNCHD_DIR/ai.missioncontrol.lanrelay.plist"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ This bootstrap script currently targets macOS (launchd)."
  exit 1
fi

cd "$MC_DIR"
mkdir -p .data "$LAUNCHD_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required (22+ recommended)."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "→ pnpm not found, enabling via corepack..."
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate
fi

if [[ ! -f .env ]]; then
  echo "→ No .env found; generating secure defaults..."
  bash scripts/generate-env.sh .env
fi

# Derive a LAN IP (best effort)
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="127.0.0.1"
fi

HOSTNAME_SHORT="$(scutil --get LocalHostName 2>/dev/null || hostname -s || echo marcel)"
PORT_VALUE="3244"

# Ensure required runtime vars exist (append-only, no secret overwrite)
ensure_env_key() {
  local key="$1"
  local value="$2"
  if grep -Eq "^${key}=" .env; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^${key}=.*|${key}=${value}|" .env
    else
      sed -i "s|^${key}=.*|${key}=${value}|" .env
    fi
  else
    echo "${key}=${value}" >> .env
  fi
}

# Keep app local-only and expose LAN via relay
ensure_env_key "PORT" "$PORT_VALUE"
ensure_env_key "MC_BIND_HOST" "127.0.0.1"

# Host allowlist for browser access
ALLOWLIST="localhost,127.0.0.1,${LAN_IP},${HOSTNAME_SHORT},${HOSTNAME_SHORT}.local"
ensure_env_key "MC_ALLOWED_HOSTS" "$ALLOWLIST"

# Better defaults for local HTTP sessions
if grep -Eq '^MC_COOKIE_SECURE=' .env; then
  ensure_env_key "MC_COOKIE_SECURE" "false"
fi

echo "→ Installing dependencies"
pnpm install

echo "→ Building production bundle"
if ! pnpm build; then
  if [[ -f "$MC_DIR/.next/BUILD_ID" ]]; then
    echo "⚠️ Build command returned non-zero, but .next/BUILD_ID exists; continuing."
  else
    echo "❌ Build failed and no .next output found."
    exit 1
  fi
fi

cat > "$MC_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>ai.missioncontrol</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>$MC_DIR/scripts/start-service.sh</string>
    </array>
    <key>WorkingDirectory</key><string>$MC_DIR</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
      <key>NODE_ENV</key><string>production</string>
      <key>PORT</key><string>$PORT_VALUE</string>
      <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StandardOutPath</key><string>$MC_DIR/.data/mc.log</string>
    <key>StandardErrorPath</key><string>$MC_DIR/.data/mc.log</string>
  </dict>
</plist>
PLIST

cat > "$RELAY_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>ai.missioncontrol.lanrelay</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/python3</string>
      <string>$MC_DIR/scripts/lan-relay.py</string>
    </array>
    <key>WorkingDirectory</key><string>$MC_DIR</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
      <key>RELAY_BIND_HOST</key><string>$LAN_IP</string>
      <key>RELAY_PORT</key><string>$PORT_VALUE</string>
      <key>UPSTREAM_HOST</key><string>127.0.0.1</string>
      <key>UPSTREAM_PORT</key><string>$PORT_VALUE</string>
    </dict>
    <key>StandardOutPath</key><string>$MC_DIR/.data/lanrelay.log</string>
    <key>StandardErrorPath</key><string>$MC_DIR/.data/lanrelay.log</string>
  </dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/ai.missioncontrol" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/ai.missioncontrol.lanrelay" >/dev/null 2>&1 || true

launchctl bootstrap "gui/$(id -u)" "$MC_PLIST"
launchctl bootstrap "gui/$(id -u)" "$RELAY_PLIST"

launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol"
launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol.lanrelay"

bash "$MC_DIR/scripts/mc-healthcheck.sh"

echo ""
echo "✅ Mission Control bootstrap complete"
echo "Local URL: http://localhost:${PORT_VALUE}"
echo "LAN URL:   http://${LAN_IP}:${PORT_VALUE}"
echo "mDNS URL:  http://${HOSTNAME_SHORT}.local:${PORT_VALUE}"
echo ""
echo "Open that LAN URL from your personal browser (same Wi-Fi/LAN)."
