"""
Execution Router — Routes scanner signals to paper logging and/or live broker.

The scanner identifies setups. The router decides what to do with them:
  1. Check which accounts are subscribed
  2. For each account, check safety gates (position cap, daily halt, risk %)
  3. Route to paper logger, live broker, or both

Each account has its own risk config so Greg can trade 10% risk while Ross
trades 2% — same signals, different sizing.
"""

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger("execution_router")

HALT_FLAG = Path("/tmp/execution_halt")


def _send_telegram(msg: str) -> None:
    """Fire-and-forget Telegram alert to Ross on live execution events."""
    import httpx
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "8787239235")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — skipping Telegram alert")
        return
    try:
        with httpx.Client(timeout=5) as client:
            client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": msg, "parse_mode": "HTML"},
            )
    except Exception as e:
        logger.error(f"Telegram alert failed: {e}")


# Default risk config for new accounts
DEFAULT_RISK = {
    "max_per_tf_per_instrument": 1,   # 1 open trade per TF per instrument
    "max_per_instrument": 2,          # 2 max across all TFs
    "daily_loss_halt": 3,             # 3 losses today = halt
    "min_confidence": 4,              # 4/5 minimum conditions
    "risk_pct": 2.0,                  # 2% of account per trade
    "qty": 1,                         # default 1 micro contract
}


def get_active_accounts(conn) -> list:
    """Return all active trading accounts."""
    rows = conn.execute(
        "SELECT * FROM trading_accounts WHERE active=1"
    ).fetchall()
    return [dict(r) for r in rows]


def get_account_risk(account: dict) -> dict:
    """Parse risk config from account, with defaults."""
    try:
        risk = json.loads(account.get("risk_config") or "{}")
    except (json.JSONDecodeError, TypeError):
        risk = {}
    merged = {**DEFAULT_RISK, **risk}
    return merged


def check_gates(conn, symbol, timeframe, direction, account_id, risk) -> str | None:
    """Check safety gates for a specific account. Returns None if OK, or skip reason."""

    # Gate 1: Same-TF dedup
    existing = conn.execute(
        "SELECT id FROM paper_trades WHERE symbol=? AND timeframe=? AND direction=? "
        "AND status='OPEN' AND account_id=?",
        (symbol, timeframe, direction, account_id)
    ).fetchone()
    if existing:
        return f"same-TF dedup (#{existing[0]} open)"

    # Gate 2: Position cap per instrument
    open_count = conn.execute(
        "SELECT COUNT(*) FROM paper_trades WHERE symbol=? AND status='OPEN' AND account_id=?",
        (symbol, account_id)
    ).fetchone()[0]
    if open_count >= risk["max_per_instrument"]:
        return f"position cap ({open_count}/{risk['max_per_instrument']} open)"

    # Gate 3: Daily loss halt
    today_losses = conn.execute(
        "SELECT COUNT(*) FROM paper_trades WHERE symbol=? AND status='LOSS' "
        "AND date(ts_exit)=date('now') AND account_id=?",
        (symbol, account_id)
    ).fetchone()[0]
    if today_losses >= risk["daily_loss_halt"]:
        return f"daily loss halt ({today_losses} losses today)"

    return None


def route_signal(symbol, timeframe, sig, alert_id=None):
    """Route a 4/5+ signal to all active accounts.

    For each account:
      - Check if signal meets account's min confidence
      - Check safety gates
      - Log paper trade if account mode includes 'paper' or 'both'
      - Place live order if account mode includes 'live' or 'both'

    Returns list of (account_id, mode, trade_id_or_error) tuples.
    """
    from data.db import get_conn, log_paper_trade, init_paper_trades
    from execution.tradovate import TradovateClient, get_front_month_symbol, SYMBOL_MAP

    init_paper_trades()
    results = []
    direction = "LONG" if sig.get("sweep_dir") == "bullish" else "SHORT"
    passed = sig.get("passed", 0)
    tl = sig.get("trade_levels", {})

    if not tl.get("stop") or not tl.get("target"):
        logger.debug("Router: missing trade levels — skip")
        return results

    kz_active = sig.get("conditions", {}).get("kill_zone", {}).get("pass", False)
    notes = f"{passed}/5 | KZ={'active' if kz_active else 'inactive'}"
    fvg_mid = (tl.get("entry_low", 0) + tl.get("entry_high", 0)) / 2 if tl.get("entry_low") else sig.get("price")

    conn = get_conn()

    # Get active accounts; fall back to default ross/paper if no accounts table yet
    try:
        accounts = get_active_accounts(conn)
    except Exception:
        accounts = [{"id": "ross", "mode": "paper", "risk_config": None, "credentials": None, "broker": None}]

    conn.close()

    for acct in accounts:
        acct_id = acct["id"]
        acct_mode = acct.get("mode", "paper")
        risk = get_account_risk(acct)

        # Check minimum confidence
        if passed < risk["min_confidence"]:
            logger.debug(f"Router: {acct_id} skip — {passed}/5 < min {risk['min_confidence']}")
            continue

        # Check safety gates (use fresh connection for atomic check)
        conn = get_conn()
        conn.execute("BEGIN IMMEDIATE")
        skip_reason = check_gates(conn, symbol, timeframe, direction, acct_id, risk)
        if skip_reason:
            conn.rollback()
            conn.close()
            logger.info(f"Router: {acct_id} SKIP {symbol} {timeframe} {direction}: {skip_reason}")
            results.append((acct_id, "skip", skip_reason))
            continue
        conn.commit()
        conn.close()

        # Route to paper
        if acct_mode in ("paper", "both"):
            try:
                trade_id = log_paper_trade(
                    symbol=symbol, timeframe=timeframe, direction=direction,
                    entry_price=round(fvg_mid, 2),
                    entry_low=tl.get("entry_low"), entry_high=tl.get("entry_high"),
                    stop_price=tl["stop"], target_price=tl["target"],
                    atr=sig.get("atr"), alert_id=alert_id,
                    confidence=sig.get("confidence"),
                    kz_active=int(kz_active), notes=notes,
                    account_id=acct_id, mode="paper",
                )
                logger.info(f"Router: {acct_id} PAPER #{trade_id} {symbol} {direction} {timeframe}")
                results.append((acct_id, "paper", trade_id))
            except Exception as e:
                logger.error(f"Router: {acct_id} paper log failed: {e}")
                results.append((acct_id, "paper_error", str(e)))

        # Route to live broker
        if acct_mode in ("live", "both"):
            # Kill switch — halt file blocks all live execution
            if HALT_FLAG.exists():
                logger.warning(f"Router: {acct_id} live HALTED — kill switch active")
                results.append((acct_id, "live_skip", "kill switch active"))
                continue

            # Duplicate live signal guard — same symbol/TF/direction within 5 minutes
            conn = get_conn()
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            recent_live = conn.execute(
                "SELECT id FROM paper_trades WHERE symbol=? AND timeframe=? AND direction=? "
                "AND mode='live' AND ts_entry > ?",
                (symbol, timeframe, direction, cutoff),
            ).fetchone()
            conn.close()
            if recent_live:
                logger.warning(
                    f"Router: {acct_id} duplicate live guard — #{recent_live[0]} already within 5min"
                )
                results.append((acct_id, "live_skip", f"duplicate signal #{recent_live[0]}"))
                continue

            try:
                creds = json.loads(acct.get("credentials") or "{}")
                if not creds.get("username") or not creds.get("cid"):
                    logger.warning(f"Router: {acct_id} live skip — no credentials configured")
                    results.append((acct_id, "live_error", "no credentials"))
                    continue

                client = TradovateClient(
                    username=creds["username"],
                    password=creds["password"],
                    cid=creds["cid"],
                    sec=creds["sec"],
                    live=True,
                )
                client.authenticate()

                # Map scanner symbol to Tradovate front-month micro contract
                tv_symbol = get_front_month_symbol(symbol)
                action = "Buy" if direction == "LONG" else "Sell"
                qty = risk.get("qty", 1)

                # Place bracket order: entry + stop + target
                order = client.place_bracket_order(
                    symbol=tv_symbol,
                    action=action,
                    qty=qty,
                    stop_price=tl["stop"],
                    target_price=tl["target"],
                )

                order_id = order.get("id") or order.get("orderId")

                # Also log to DB for dashboard tracking
                trade_id = log_paper_trade(
                    symbol=symbol, timeframe=timeframe, direction=direction,
                    entry_price=round(fvg_mid, 2),
                    entry_low=tl.get("entry_low"), entry_high=tl.get("entry_high"),
                    stop_price=tl["stop"], target_price=tl["target"],
                    atr=sig.get("atr"), alert_id=alert_id,
                    confidence=sig.get("confidence"),
                    kz_active=int(kz_active), notes=f"{notes} | LIVE",
                    account_id=acct_id, mode="live",
                    broker_order_id=str(order_id) if order_id else None,
                )

                logger.info(f"Router: {acct_id} LIVE #{trade_id} {symbol} {direction} "
                            f"{tv_symbol} order={order_id}")
                results.append((acct_id, "live", trade_id))

                _send_telegram(
                    f"🟢 <b>LIVE ORDER PLACED</b>\n"
                    f"{symbol} {direction} {timeframe}\n"
                    f"Contract: {tv_symbol} × {qty}\n"
                    f"Entry: {round(fvg_mid, 2)} | Stop: {tl['stop']} | Target: {tl['target']}\n"
                    f"Order ID: {order_id} | Trade #{trade_id}"
                )

            except Exception as e:
                logger.error(f"Router: {acct_id} live execution failed: {e}")
                results.append((acct_id, "live_error", str(e)))
                _send_telegram(
                    f"🔴 <b>LIVE EXECUTION ERROR</b>\n"
                    f"Account: {acct_id} | {symbol} {direction} {timeframe}\n"
                    f"Error: {str(e)[:300]}"
                )

    # Broadcast signal to remote agents via WebSocket server
    _broadcast_to_agents(symbol, timeframe, direction, sig)

    return results


def _broadcast_to_agents(symbol, timeframe, direction, sig):
    """POST signal to the local FastAPI server for WebSocket broadcast to remote agents.
    Non-blocking, failure is non-critical (paper/live routing already completed)."""
    try:
        import httpx
        from datetime import datetime, timezone

        tl = sig.get("trade_levels", {})
        fvg_mid = (tl.get("entry_low", 0) + tl.get("entry_high", 0)) / 2 if tl.get("entry_low") else sig.get("price")
        ts = datetime.now(timezone.utc)

        payload = {
            "signal_id": f"sig_{ts.strftime('%Y%m%d_%H%M%S')}_{symbol.replace('=', '')}",
            "symbol": symbol,
            "timeframe": timeframe,
            "direction": direction,
            "entry_price": round(fvg_mid, 2),
            "entry_low": tl.get("entry_low"),
            "entry_high": tl.get("entry_high"),
            "stop_price": tl.get("stop"),
            "target_price": tl.get("target"),
            "t1": tl.get("t1"),
            "t2": tl.get("t2"),
            "t3": tl.get("t3"),
            "rr": tl.get("rr"),
            "confidence": sig.get("confidence", 80),
            "passed": sig.get("passed", 4),
            "atr": sig.get("atr"),
            "timestamp": ts.isoformat(),
        }

        with httpx.Client(timeout=5) as client:
            resp = client.post("http://127.0.0.1:8080/api/signal/broadcast", json=payload)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("agents_delivered", 0) > 0:
                    logger.info(f"Signal broadcast to {data['agents_delivered']} agent(s)")
            else:
                logger.debug(f"Signal broadcast returned {resp.status_code}")

    except Exception as e:
        logger.debug(f"Signal broadcast failed (non-critical): {e}")
