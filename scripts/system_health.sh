#!/usr/bin/env bash
# Killzone System Health + Self-Heal
#
# Runs every hour via root cron. For each subsystem:
#   1. CHECK     — observe current state
#   2. HEAL      — if degraded, attempt automatic remediation
#   3. RECHECK   — observe again
#   4. STATUS    — green / healed / red
#
# Writes JSON to /var/lib/system-health/status.json so the morning
# briefing routine just reads that file (no remote checks, no XML
# tool-call leakage, no false-positive action items).
#
# Action items are populated ONLY for checks that remained red after a
# heal attempt. Successfully-healed items are logged but not surfaced
# unless the heal had to happen — those go into the `healed` list so
# Ross can spot patterns.
#
# Exit codes (for cron monitoring):
#   0 — all green or all healed
#   1 — at least one red action item remains

set -uo pipefail

STATUS_DIR=/var/lib/system-health
STATUS_FILE=$STATUS_DIR/status.json
LOG_FILE=/var/log/system-health.log
TS=$(date -Iseconds)

mkdir -p "$STATUS_DIR"

CHECKS_JSON=""
ACTIONS_JSON=""
HEALED_JSON=""
RED_COUNT=0

log() { echo "[$TS] $*" | tee -a "$LOG_FILE"; }

# Append a structured check entry to the JSON arrays.
# args: name, status (green|healed|red), detail, action_taken, action_item
record() {
  local name="$1" status="$2" detail="$3" action_taken="${4:-}" action_item="${5:-}"
  local entry
  entry=$(python3 -c "
import json, sys
print(json.dumps({
  'name': sys.argv[1],
  'status': sys.argv[2],
  'detail': sys.argv[3],
  'action_taken': sys.argv[4] or None,
  'action_item': sys.argv[5] or None,
}))" "$name" "$status" "$detail" "$action_taken" "$action_item")
  CHECKS_JSON="${CHECKS_JSON:+$CHECKS_JSON,}$entry"
  case "$status" in
    healed) HEALED_JSON="${HEALED_JSON:+$HEALED_JSON,}\"$name\"" ;;
    red)    ACTIONS_JSON="${ACTIONS_JSON:+$ACTIONS_JSON,}$entry"; RED_COUNT=$((RED_COUNT + 1)) ;;
  esac
  log "$name: $status — $detail${action_taken:+ [healed: $action_taken]}${action_item:+ [action: $action_item]}"
}

# ── 1. Docker daemon ──────────────────────────────────────────────────────────
check_docker() {
  if systemctl is-active --quiet docker; then
    record "docker_daemon" "green" "Docker daemon is active"
    return 0
  fi
  log "docker_daemon: down — attempting restart"
  if systemctl restart docker && sleep 2 && systemctl is-active --quiet docker; then
    record "docker_daemon" "healed" "Was down, restarted successfully" "systemctl restart docker"
  else
    record "docker_daemon" "red" "Docker daemon down and restart failed" "systemctl restart docker (failed)" "Investigate Docker daemon — systemctl status docker"
  fi
}

# ── 2. Trading cron log dir ───────────────────────────────────────────────────
check_cron_log_dir() {
  local dir=/var/log/trading-cron
  if [[ -d "$dir" ]]; then
    record "cron_log_dir" "green" "$dir exists"
    return 0
  fi
  log "cron_log_dir: missing — creating"
  if mkdir -p "$dir" && chmod 755 "$dir"; then
    record "cron_log_dir" "healed" "Created $dir" "mkdir -p $dir"
  else
    record "cron_log_dir" "red" "$dir missing and mkdir failed" "" "Manually create $dir"
  fi
}

# ── 3. Critical systemd services ──────────────────────────────────────────────
check_systemd_services() {
  # Names taken from SESSION-STATE; cloudflared was wrong, real unit is cloudflare-tunnel.
  local services=(captain-hook ict-dashboard-api ict-dashboard-web tv-webhook cloudflare-tunnel)
  for svc in "${services[@]}"; do
    # is-active returns exit-code based status. Don't pre-check "installed"
    # via grep — handled implicitly: a missing unit fails restart cleanly.
    if systemctl is-active --quiet "$svc"; then
      record "service_${svc}" "green" "Service running"
      continue
    fi
    log "service_${svc}: down — attempting restart"
    systemctl restart "$svc" 2>/dev/null
    sleep 3
    if systemctl is-active --quiet "$svc"; then
      record "service_${svc}" "healed" "Was down, restarted successfully" "systemctl restart $svc"
    else
      record "service_${svc}" "red" "Service down and restart failed" "systemctl restart $svc (failed)" "journalctl -u $svc -n 30"
    fi
  done
}

# ── 4. Public HTTPS endpoints ─────────────────────────────────────────────────
check_endpoints() {
  declare -A endpoints=(
    [api]=https://api.ictwealthbuilding.com/api/version
    [dashboard]=https://dashboard.ictwealthbuilding.com/
    [webhook]=https://webhook.ictwealthbuilding.com/health
  )
  for name in "${!endpoints[@]}"; do
    local url=${endpoints[$name]}
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^(200|204)$ ]]; then
      record "endpoint_${name}" "green" "$url -> $code"
      continue
    fi
    # Map endpoint -> service to restart for the heal attempt
    local heal_svc=""
    case "$name" in
      api)       heal_svc=ict-dashboard-api ;;
      dashboard) heal_svc=ict-dashboard-web ;;
      webhook)   heal_svc=tv-webhook ;;
    esac
    log "endpoint_${name}: HTTP $code — attempting restart of $heal_svc"
    systemctl restart "$heal_svc" 2>/dev/null
    sleep 5
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^(200|204)$ ]]; then
      record "endpoint_${name}" "healed" "Was HTTP $code, now 200" "systemctl restart $heal_svc"
    else
      record "endpoint_${name}" "red" "$url returned HTTP $code (also after restart)" "systemctl restart $heal_svc (didn't help)" "Investigate $heal_svc — journalctl -u $heal_svc -n 30"
    fi
  done
}

# ── 5. Scanners ran today ─────────────────────────────────────────────────────
check_scanners_today() {
  local today dow
  today=$(date -u +%Y-%m-%d)
  dow=$(date -u +%u)  # 1=Mon ... 7=Sun
  # Futures markets closed Saturday + Sunday (UTC), so no scanner runs is expected.
  if [[ "$dow" == "6" || "$dow" == "7" ]]; then
    record "scanner_15m" "green" "Weekend — futures markets closed, no scanner runs expected"
    record "scanner_1h"  "green" "Weekend — futures markets closed, no scanner runs expected"
    return 0
  fi
  # sqlite3 CLI isn't installed on this VPS — use python's sqlite3 module instead.
  for tf in 15m 1h; do
    local last
    last=$(python3 -c "
import sqlite3
c = sqlite3.connect('/opt/trading-workspace/trading/data/trading.db')
row = c.execute('SELECT ts FROM signals WHERE timeframe=? ORDER BY ts DESC LIMIT 1', ('${tf}',)).fetchone()
print(row[0] if row else '')
" 2>/dev/null)
    if [[ -z "$last" ]]; then
      record "scanner_${tf}" "red" "No signals ever logged" "" "Investigate ${tf} scanner cron"
      continue
    fi
    if [[ "$last" == ${today}* ]]; then
      record "scanner_${tf}" "green" "Last signal at ${last:11:5} UTC today"
    else
      # Don't try to "heal" the scanner from this script — too invasive.
      # Just surface the action item.
      record "scanner_${tf}" "red" "Last signal was ${last:0:10} (not today)" "" "Check /opt/trading-cron.sh and recent runs in /var/log/trading-cron/"
    fi
  done
}

# ── 6. Disk + memory pressure ─────────────────────────────────────────────────
check_resources() {
  local disk_pct
  disk_pct=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
  local mem_avail_gb
  mem_avail_gb=$(free -g | awk '/^Mem:/ {print $7}')

  if (( disk_pct >= 90 )); then
    record "resource_disk" "red" "Root filesystem ${disk_pct}% full" "" "Free space — check /var/log /docker for large files"
  elif (( disk_pct >= 80 )); then
    record "resource_disk" "healed" "Root filesystem ${disk_pct}% — running journalctl --vacuum-time=14d" "journalctl --vacuum-time=14d"
    journalctl --vacuum-time=14d >/dev/null 2>&1
  else
    record "resource_disk" "green" "Root filesystem ${disk_pct}% used"
  fi

  if (( mem_avail_gb < 1 )); then
    record "resource_memory" "red" "Only ${mem_avail_gb}GB memory available" "" "Investigate memory hogs — top -o %MEM"
  else
    record "resource_memory" "green" "${mem_avail_gb}GB memory available"
  fi
}

# ── 7. LLM auth path ──────────────────────────────────────────────────────────
check_llm_auth() {
  local last
  last=$(python3 -c "import json; print(json.load(open('/opt/llm-config.json')).get('last_success','unknown'))" 2>/dev/null)
  if [[ "$last" == "claude-cli" ]]; then
    record "llm_auth" "green" "last_success=claude-cli (Max subscription, \$0 path)"
  elif [[ "$last" == "anthropic-api" ]]; then
    record "llm_auth" "red" "last_success=anthropic-api (paid path active)" "" "Check CLAUDE_CODE_OAUTH_TOKEN in /opt/ict-discord-bot/.env — may need claude setup-token rotation"
  else
    record "llm_auth" "red" "last_success=${last}" "" "Investigate /opt/llm-config.json"
  fi
}

# ── Run all checks ────────────────────────────────────────────────────────────
check_docker
check_cron_log_dir
check_systemd_services
check_endpoints
check_scanners_today
check_resources
check_llm_auth

# ── Assemble final JSON ───────────────────────────────────────────────────────
overall="green"
if (( RED_COUNT > 0 )); then overall="red"
elif [[ -n "$HEALED_JSON" ]]; then overall="healed"
fi

cat > "$STATUS_FILE.tmp" <<EOF
{
  "timestamp": "$TS",
  "overall": "$overall",
  "red_count": $RED_COUNT,
  "healed": [$HEALED_JSON],
  "checks": [$CHECKS_JSON],
  "action_items": [$ACTIONS_JSON]
}
EOF
mv "$STATUS_FILE.tmp" "$STATUS_FILE"
chmod 644 "$STATUS_FILE"

log "overall=$overall red_count=$RED_COUNT (status written to $STATUS_FILE)"
[[ "$overall" == "red" ]] && exit 1 || exit 0
