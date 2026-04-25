#!/usr/bin/env bash
# Killzone LLM auth health check.
#
# Reads /opt/llm-config.json and watches `last_success`. If it has been
# anything other than `claude-cli` for 4 consecutive runs (2 hours at the
# 30-minute cron cadence), pings Ross via Telegram so we don't burn
# another night on the paid Anthropic API key.
#
# State file at /var/lib/llm-failover/consec_non_oauth tracks consecutive
# non-OAuth runs. Cleared the moment claude-cli wins again.
#
# Cron entry (added separately):
#   */30 * * * * /opt/scripts/llm_auth_check.sh >> /var/log/llm-auth-check.log 2>&1

set -euo pipefail

CONFIG=/opt/llm-config.json
STATE_DIR=/var/lib/llm-failover
COUNTER=$STATE_DIR/consec_non_oauth
ALERT_THRESHOLD=4
TS=$(date -Iseconds)

mkdir -p "$STATE_DIR"

if [[ ! -f "$CONFIG" ]]; then
  echo "[$TS] ERROR: $CONFIG missing" >&2
  exit 1
fi

LAST=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('last_success','unknown'))")
echo "[$TS] last_success=$LAST"

if [[ "$LAST" == "claude-cli" ]]; then
  if [[ -f "$COUNTER" ]]; then
    PREV=$(cat "$COUNTER")
    rm -f "$COUNTER"
    echo "[$TS] recovered (was $PREV consecutive non-OAuth)"
  fi
  exit 0
fi

COUNT=$(cat "$COUNTER" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER"
echo "[$TS] consecutive non-OAuth count: $COUNT/$ALERT_THRESHOLD"

if [[ "$COUNT" -ne "$ALERT_THRESHOLD" ]]; then
  exit 0
fi

# Hit threshold — alert exactly once
TOKEN=${TELEGRAM_BOT_TOKEN:-}
CHAT=${TELEGRAM_ROSS_ID:-}
if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
  if [[ -f /opt/ict-discord-bot/.env ]]; then
    TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' /opt/ict-discord-bot/.env | head -1 | cut -d= -f2-)
    CHAT=$(grep -E '^TELEGRAM_ROSS_ID=' /opt/ict-discord-bot/.env | head -1 | cut -d= -f2-)
  fi
fi

if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
  echo "[$TS] ERROR: cannot find TELEGRAM_BOT_TOKEN/TELEGRAM_ROSS_ID — alert not sent" >&2
  exit 2
fi

MSG="⚠️ Killzone LLM auth degraded — last_success=${LAST} for 2h+ (${COUNT} consecutive checks). claude -p OAuth (CLAUDE_CODE_OAUTH_TOKEN) may be expired. Re-run \`claude setup-token\` on WSL, scp to /root/new_oat.txt, then update /opt/ict-discord-bot/.env."

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d "chat_id=${CHAT}" \
  --data-urlencode "text=${MSG}" >/dev/null
echo "[$TS] alerted"
