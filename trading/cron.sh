#!/bin/bash
# Trading cron wrapper — runs scripts inside OpenClaw container
# Sends Telegram alerts when keywords detected in output
# Zero LLM cost — pure bash + Python
# Migrated from OpenClaw 2026-04-17, fixed escaping 2026-04-17

# CONTAINER removed — OpenClaw deprecated
BOT_TOKEN="8622733442:AAFes3D88azr0v_N12gzY5CE3RbS7yNSVaU"
CHAT_ID="8787239235"
LOGDIR="/var/log/trading-cron"

# Trading .env vars — passed explicitly to avoid bash escaping issues with $(cat .env)
TENV="ALPACA_API_KEY=AKWNATFJ6XGSQRZP4ZER7V33FS ALPACA_SECRET_KEY=GoaDvB7iuNphB393Q5c6ccFBsoquAp3QrLEkCjBgUSQx ALPACA_BASE_URL=https://api.alpaca.markets ALPACA_DATA_URL=https://data.alpaca.markets DISCORD_WEBHOOK_DAILY=https://discord.com/api/webhooks/1485817657277288619/MByw8L5bvbtU5mRGWuh5sz194RWlU1aTZRvq_Ct9ToQOOUTZH5M8Jr2j4slwCleolaL6 DISCORD_WEBHOOK_1H=https://discord.com/api/webhooks/1485817881366106132/zT0S29ViEKKbqtVGyzUECWkoi0VntSn_7J_0dnJ8Qv9wi-367qbUZay8FQNW4V068Zc_ DISCORD_WEBHOOK_15M=https://discord.com/api/webhooks/1485817944754753606/SWc7nTJGW6VDDvzaiceNo3_sWTFaivRCHDlLIwAtA8FBb33vrC__bY_fbrX7L4aLMxsM DISCORD_WEBHOOK_ICT_ALERTS=https://discord.com/api/webhooks/1488571451320696933/o-2jZ5imhteiCW6W09vyK0P9PcjunfEl9eq0nT8IU0kBqRWnKtH7MQoSXWRYwzPE-a17 TELEGRAM_TOKEN=8622733442:AAFes3D88azr0v_N12gzY5CE3RbS7yNSVaU TELEGRAM_CHAT_ID=8787239235"

mkdir -p "$LOGDIR"

send_telegram() {
    local msg="$1"
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d chat_id="$CHAT_ID" \
        -d text="$msg" \
        -d parse_mode="HTML" > /dev/null 2>&1
}

# ── Helper: run command inside container with trading env vars ────────────────
# Run directly on host (migrated from docker exec — OpenClaw deprecated)
TRADING_DIR="/opt/trading-workspace/trading"
export ALPACA_API_KEY=AKWNATFJ6XGSQRZP4ZER7V33FS
export ALPACA_SECRET_KEY=GoaDvB7iuNphB393Q5c6ccFBsoquAp3QrLEkCjBgUSQx
export ALPACA_BASE_URL=https://api.alpaca.markets
export ALPACA_DATA_URL=https://data.alpaca.markets
export DISCORD_WEBHOOK_DAILY=https://discord.com/api/webhooks/1485817657277288619/MByw8L5bvbtU5mRGWuh5sz194RWlU1aTZRvq_Ct9ToQOOUTZH5M8Jr2j4slwCleolaL6
export DISCORD_WEBHOOK_1H=https://discord.com/api/webhooks/1485817881366106132/zT0S29ViEKKbqtVGyzUECWkoi0VntSn_7J_0dnJ8Qv9wi-367qbUZay8FQNW4V068Zc_
export DISCORD_WEBHOOK_15M=https://discord.com/api/webhooks/1485817944754753606/SWc7nTJGW6VDDvzaiceNo3_sWTFaivRCHDlLIwAtA8FBb33vrC__bY_fbrX7L4aLMxsM
export DISCORD_WEBHOOK_ICT_ALERTS=https://discord.com/api/webhooks/1488571451320696933/o-2jZ5imhteiCW6W09vyK0P9PcjunfEl9eq0nT8IU0kBqRWnKtH7MQoSXWRYwzPE-a17
export TELEGRAM_TOKEN=8622733442:AAFes3D88azr0v_N12gzY5CE3RbS7yNSVaU
export TELEGRAM_CHAT_ID=8787239235
export WEBHOOK_SECRET=MVgDv2B1kyrhK16yy4AxANp0bdTtuCMEYy9IxviS7HU
export PYTHONPATH="$TRADING_DIR:$TRADING_DIR/bots/futures"

run_on_host() {
    bash -c "$1" 2>&1
}

# ── Job runners ──────────────────────────────────────────────────────────────

run_crypto_momentum() {
    local output
    output=$(run_on_host "cd $TRADING_DIR/crypto && python3 crypto_main.py")
    echo "[$(date -Iseconds)] crypto-momentum" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/crypto-momentum.log"

    if echo "$output" | grep -qiE "Buy submitted|Sell submitted|halted|Trading halted"; then
        send_telegram "Crypto Momentum Alert
$output"
    fi
}

run_crypto_lab_ict() {
    local output
    output=$(ALPACA_API_KEY=PKB65AG2M2T2C7EWABQUWOS6JM ALPACA_SECRET_KEY=C1n187RKnWbkAEq3D6CMBZAy7445UbCf4F7MrQdpooAs ALPACA_BASE_URL=https://paper-api.alpaca.markets bash -c "cd $TRADING_DIR/crypto-lab && python3 crypto_main.py" 2>&1)
    echo "[$(date -Iseconds)] crypto-lab-ict" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/crypto-lab-ict.log"

    if echo "$output" | grep -qiE "Buy submitted|Sell submitted|halted|Trading halted"; then
        send_telegram "ICT Lab Alert
$output"
    fi
}

run_fast_trigger() {
    local output
    output=$(ALPACA_API_KEY=PKB65AG2M2T2C7EWABQUWOS6JM ALPACA_SECRET_KEY=C1n187RKnWbkAEq3D6CMBZAy7445UbCf4F7MrQdpooAs ALPACA_BASE_URL=https://paper-api.alpaca.markets bash -c "cd $TRADING_DIR/crypto-lab/fast_trigger && python3 fast_main.py" 2>&1)
    echo "[$(date -Iseconds)] fast-trigger" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/fast-trigger.log"

    if echo "$output" | grep -qiE "FAST TRIGGER BUY|FAST TRIGGER SELL|FAST TRIGGER HALTED"; then
        send_telegram "$output"
    fi
}

run_futures_scanner() {
    local tf="$1"
    local output
    output=$(run_on_host "cd $TRADING_DIR && python3 futures_scanner.py --timeframe $tf")
    echo "[$(date -Iseconds)] futures-scanner-$tf" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/futures-scanner-$tf.log"
}

run_db_sync() {
    local output
    output=$(run_on_host "cd $TRADING_DIR && python3 sync_to_duckdb.py")
    echo "[$(date -Iseconds)] db-sync" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/db-sync.log"
}

run_crypto_health() {
    local output
    output=$(run_on_host "cd $TRADING_DIR/crypto && python3 crypto_health_check.py")
    echo "[$(date -Iseconds)] crypto-health" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/crypto-health.log"

    if [ -n "$output" ] && [ "$output" != "" ]; then
        send_telegram "Crypto Health Check
$output"
    fi
}

run_trading_db_summary() {
    local output
    output=$(run_on_host 'cd $TRADING_DIR && python3 -c "
import sys; sys.path.insert(0, \".\")
from data.db import summary, alert_win_rate
s = summary()
wr = alert_win_rate()
print(f\"DB Summary: {s}\")
print(f\"Alert win rate: {wr}\")
"')
    echo "[$(date -Iseconds)] db-summary" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/db-summary.log"

    if echo "$output" | grep -qE "outcomes.*[1-9]|win_rate"; then
        send_telegram "Trading DB Summary
$output"
    fi
}

run_daily_summary() {
    local output
    output=$(run_on_host "cd $TRADING_DIR && python3 daily_summary.py")
    echo "[$(date -Iseconds)] daily-summary" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/daily-summary.log"
    send_telegram "Daily Trading Summary
$output"
}

run_eod_check() {
    local output
    output=$(run_on_host "cd $TRADING_DIR && python3 eod_check.py")
    echo "[$(date -Iseconds)] eod-check" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/eod-check.log"

    if [ -n "$output" ] && [ "$output" != "" ]; then
        send_telegram "EOD Trading Check
$output"
    fi
}

run_health_check() {
    local output
    output=$(run_on_host "cd $TRADING_DIR && python3 health_check.py")
    echo "[$(date -Iseconds)] health-check" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/health-check.log"
    send_telegram "Weekly Trading Health Check
$output"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

case "$1" in
    crypto-momentum)    run_crypto_momentum ;;
    crypto-lab-ict)     run_crypto_lab_ict ;;
    fast-trigger)       run_fast_trigger ;;
    futures-15m)        run_futures_scanner 15m ;;
    futures-1h)         run_futures_scanner 1h ;;
    futures-daily)      run_futures_scanner 1d ;;
    db-sync)            run_db_sync ;;
    crypto-health)      run_crypto_health ;;
    db-summary)         run_trading_db_summary ;;
    daily-summary)      run_daily_summary ;;
    eod-check)          run_eod_check ;;
    health-check)       run_health_check ;;
    stock-rsi)          run_stock_rsi ;;
    stock-orb)          run_stock_orb ;;
    stock-status)       run_stock_status ;;
    *)
        echo "Usage: $0 {crypto-momentum|crypto-lab-ict|fast-trigger|futures-15m|futures-1h|futures-daily|db-sync|crypto-health|db-summary|daily-summary|eod-check|health-check}"
        exit 1
        ;;
esac

# ── Stock Trading Bot ────────────────────────────────────────────────────────

run_stock_rsi() {
    local output
    output=$(run_on_host "cd $TRADING_DIR/stocks && python3 stock_main.py --mode rsi")
    echo "[$(date -Iseconds)] stock-rsi" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/stock-rsi.log"

    if echo "$output" | grep -qiE "Buy submitted|Sell submitted|BUY|SELL"; then
        send_telegram "Stock RSI Alert
$output"
    fi
}

run_stock_orb() {
    local output
    output=$(run_on_host "cd $TRADING_DIR/stocks && python3 stock_main.py --mode orb")
    echo "[$(date -Iseconds)] stock-orb" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/stock-orb.log"

    if echo "$output" | grep -qiE "Buy submitted|Sell submitted|Bracket order submitted|ORB BUY|ORB PENDING"; then
        send_telegram "Stock ORB Alert
$output"
    fi
}

run_stock_status() {
    local output
    output=$(run_on_host "cd $TRADING_DIR/stocks && python3 stock_main.py --mode status")
    echo "[$(date -Iseconds)] stock-status" >> "$LOGDIR/runs.log"
    echo "$output" >> "$LOGDIR/stock-status.log"
    echo "$output"
}
