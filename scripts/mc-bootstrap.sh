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

set -o allexport
# shellcheck disable=SC1091
source <(grep -v '^\s*#' .env | grep -v '^\s*$')
set +o allexport

is_non_loopback_ipv4() {
  local ip="$1"
  [[ -n "$ip" ]] || return 1
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  [[ "$ip" != 169.254.* ]] || return 1
  [[ "$ip" != 127.* ]]
}

plist_get_relay_bind_host() {
  local plist="$1"
  [[ -f "$plist" ]] || return 1
  python3 - "$plist" <<'PY'
import plistlib
import sys

path = sys.argv[1]
try:
    with open(path, "rb") as handle:
        data = plistlib.load(handle)
except Exception:
    raise SystemExit(1)

env = data.get("EnvironmentVariables", {})
host = str(env.get("RELAY_BIND_HOST", "")).strip()
if host:
    print(host)
PY
}

log_get_relay_bind_host() {
  local log_path="$1"
  [[ -f "$log_path" ]] || return 1
  python3 - "$log_path" <<'PY'
import re
import sys

pattern = re.compile(r"\('(\d+\.\d+\.\d+\.\d+)',\s*\d+\)")
last = ""
with open(sys.argv[1], "r", encoding="utf-8", errors="ignore") as handle:
    for line in handle:
        match = pattern.search(line)
        if match:
            last = match.group(1)
if last:
    print(last)
PY
}

detect_lan_ip() {
  local candidate iface

  for candidate in "${MC_RELAY_BIND_HOST:-}" "${RELAY_BIND_HOST:-}"; do
    if is_non_loopback_ipv4 "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "$iface" ]]; then
    candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if is_non_loopback_ipv4 "$candidate"; then
      echo "$candidate"
      return 0
    fi
  fi

  while IFS= read -r iface; do
    candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if is_non_loopback_ipv4 "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done < <(networksetup -listallhardwareports 2>/dev/null | awk '/Device: /{print $2}')

  candidate="$(plist_get_relay_bind_host "$RELAY_PLIST" || true)"
  if is_non_loopback_ipv4 "$candidate"; then
    echo "$candidate"
    return 0
  fi

  candidate="$(log_get_relay_bind_host "$MC_DIR/.data/lanrelay.log" || true)"
  if is_non_loopback_ipv4 "$candidate"; then
    echo "$candidate"
    return 0
  fi

  while IFS= read -r candidate; do
    if is_non_loopback_ipv4 "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done < <(ifconfig 2>/dev/null | awk '/inet /{print $2}')

  return 1
}

join_csv_unique() {
  python3 - "$@" <<'PY'
import sys

seen = set()
items = []
for value in sys.argv[1:]:
    for raw in value.split(","):
        item = raw.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        items.append(item)
print(",".join(items))
PY
}

LAN_IP="$(detect_lan_ip || true)"
if [[ -z "$LAN_IP" ]]; then
  echo "⚠️ Could not determine a non-loopback LAN IP automatically."
  echo "   Set MC_RELAY_BIND_HOST in .env, then rerun pnpm bootstrap:local."
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
ensure_env_key "HOSTNAME" "127.0.0.1"
ensure_env_key "MC_BIND_HOST" "127.0.0.1"

# Host allowlist for browser access
ALLOWLIST="$(join_csv_unique "localhost,127.0.0.1" "${LAN_IP:-}" "${HOSTNAME_SHORT},${HOSTNAME_SHORT}.local")"
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
      <key>RELAY_BIND_HOST</key><string>${LAN_IP:-127.0.0.1}</string>
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
if [[ -n "$LAN_IP" ]]; then
  launchctl bootstrap "gui/$(id -u)" "$RELAY_PLIST"
else
  echo "⚠️ Skipping lan-relay launchd bootstrap until MC_RELAY_BIND_HOST is configured."
fi

launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol"
if [[ -n "$LAN_IP" ]]; then
  launchctl kickstart -k "gui/$(id -u)/ai.missioncontrol.lanrelay"
fi

bash "$MC_DIR/scripts/mc-healthcheck.sh"

echo ""
echo "✅ Mission Control bootstrap complete"
echo "Local URL: http://localhost:${PORT_VALUE}"
if [[ -n "$LAN_IP" ]]; then
  echo "LAN URL:   http://${LAN_IP}:${PORT_VALUE}"
fi
echo "mDNS URL:  http://${HOSTNAME_SHORT}.local:${PORT_VALUE}"
echo ""
if [[ -n "$LAN_IP" ]]; then
  echo "Open that LAN URL from your personal browser (same Wi-Fi/LAN)."
else
  echo "Set MC_RELAY_BIND_HOST in .env and rerun bootstrap to enable direct LAN access."
fi
