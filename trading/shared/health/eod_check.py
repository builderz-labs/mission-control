#!/usr/bin/env python3
"""
End-of-Day Data Quality Check
Runs daily via /opt/trading-cron.sh eod-check. Self-analyzes the trading
system for data issues, logical problems, and anomalies. Prints a report
to stdout (cron tees to /var/log/trading-cron/eod-check.log).

Checks:
  1. Paper trade dedup integrity — any duplicate open trades?
  2. Condition logging — any all-zero signals today?
  3. Scanner freshness — did all 3 scanners run today?
  4. Alert rate — unusually high or low vs recent baseline?
  5. Paper trade count per symbol/day (dedup sanity)
  6. Win rate sanity (flag suspiciously high)
  7. Direction balance (LONG/SHORT skew)
  8. Stale OPEN trades
"""

import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

DB_PATH = Path(os.environ.get(
    "TRADING_DB_PATH",
    "/opt/trading-workspace/trading/data/trading.db",
))
ISSUES = []
NOTICES = []


def flag(msg): ISSUES.append(f"\U0001F534 {msg}")
def notice(msg): NOTICES.append(f"\U0001F7E1 {msg}")
def ok(msg): NOTICES.append(f"✅ {msg}")


def run():
    if not DB_PATH.exists():
        flag(f"DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    # 1. Duplicate open paper trades
    dupes = conn.execute("""
        SELECT symbol, timeframe, direction, COUNT(*) AS cnt
        FROM paper_trades WHERE status='OPEN'
        GROUP BY symbol, timeframe, direction
        HAVING cnt > 1
    """).fetchall()
    if dupes:
        for d in dupes:
            flag(f"Duplicate OPEN paper trade: {d[0]} {d[1]} {d[2]} x {d[3]}")
    else:
        ok("No duplicate open paper trades")

    # 2. Condition logging integrity
    total_today = conn.execute(
        "SELECT COUNT(*) FROM signals WHERE ts LIKE ?", (f"{today}%",)
    ).fetchone()[0]
    zero_today = conn.execute("""
        SELECT COUNT(*) FROM signals WHERE ts LIKE ?
        AND cond_breakout=0 AND cond_ema=0 AND cond_rsi=0
        AND cond_volume=0 AND cond_killzone=0 AND passed > 0
    """, (f"{today}%",)).fetchone()[0]
    if total_today == 0:
        flag("No signals logged today — scanners may not have run")
    elif zero_today == total_today:
        flag(f"All {total_today} signals today have zero condition data — logging bug?")
    elif zero_today > total_today * 0.5:
        notice(f"{zero_today}/{total_today} signals today have zero conditions")
    else:
        ok(f"Condition logging OK — {total_today - zero_today}/{total_today} signals have data")

    # 3. Scanner freshness (1d only runs ~13:00 UTC weekdays)
    scanner_expected_by = {"15m": 0, "1h": 0, "1d": 14}
    for tf in ["15m", "1h", "1d"]:
        last = conn.execute(
            "SELECT ts FROM signals WHERE timeframe=? ORDER BY ts DESC LIMIT 1", (tf,)
        ).fetchone()
        if not last:
            flag(f"{tf} scanner has never logged a signal")
        elif not last[0].startswith(today):
            if now.hour >= scanner_expected_by[tf]:
                flag(f"{tf} scanner last ran {last[0][:10]} — not today")
            else:
                notice(f"{tf} scanner not yet run today (scheduled later)")
        else:
            ok(f"{tf} scanner ran today (last: {last[0][11:16]} UTC)")

    # 4. Alert rate vs 7-day baseline
    alerts_today = conn.execute(
        "SELECT COUNT(*) FROM alerts WHERE ts LIKE ?", (f"{today}%",)
    ).fetchone()[0]
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    alerts_week = conn.execute(
        "SELECT COUNT(*) FROM alerts WHERE ts >= ?", (week_ago,)
    ).fetchone()[0]
    daily_avg = alerts_week / 7
    if alerts_today > daily_avg * 3 and alerts_today > 10:
        flag(f"Alert spike: {alerts_today} today vs {daily_avg:.1f}/day avg — dedup may be failing")
    elif alerts_today == 0 and total_today > 0:
        notice(f"No alerts today ({total_today} scans ran) — quiet market or thresholds high")
    else:
        ok(f"Alert rate normal: {alerts_today} today vs {daily_avg:.1f}/day avg")

    # 5. Paper trade count per symbol/tf/direction today
    trades_today = conn.execute("""
        SELECT symbol, timeframe, direction, COUNT(*) AS cnt
        FROM paper_trades WHERE ts_entry LIKE ?
        GROUP BY symbol, timeframe, direction
    """, (f"{today}%",)).fetchall()
    for t in trades_today:
        if t[3] > 3:
            flag(f"Too many paper trades: {t[0]} {t[1]} {t[2]} x {t[3]} today")

    # 6. Win rate sanity
    closed = conn.execute(
        "SELECT status, COUNT(*) FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY status"
    ).fetchall()
    result = {r[0]: r[1] for r in closed}
    wins = result.get("WIN", 0)
    losses = result.get("LOSS", 0)
    total = wins + losses
    if total >= 5:
        wr = wins / total * 100
        if wr > 90:
            flag(f"Win rate {wr:.1f}% ({wins}W/{losses}L) — suspiciously high")
        elif wr < 20 and total >= 10:
            notice(f"Win rate {wr:.1f}% ({wins}W/{losses}L) — below ICT range")
        else:
            ok(f"Win rate {wr:.1f}% ({wins}W/{losses}L total closed)")
    else:
        notice(f"Only {total} closed paper trades — too few for win rate analysis")

    # 7. Direction balance (last 3 days)
    recent_pt = conn.execute("""
        SELECT direction, COUNT(*) FROM paper_trades
        WHERE ts_entry >= ?
        GROUP BY direction
    """, ((now - timedelta(days=3)).isoformat(),)).fetchall()
    dirs = {r[0]: r[1] for r in recent_pt}
    total_dirs = sum(dirs.values())
    if total_dirs >= 4:
        long_pct = dirs.get("LONG", 0) / total_dirs * 100
        if long_pct == 100:
            notice(f"All {total_dirs} recent paper trades are LONG — SHORT detection may need review")
        elif long_pct == 0:
            notice(f"All {total_dirs} recent paper trades are SHORT — LONG detection may need review")
        else:
            ok(f"Direction balance OK: {dirs.get('LONG', 0)}L / {dirs.get('SHORT', 0)}S in last 3d")

    # 8. Stale OPEN trades (>5d old)
    stale = conn.execute("""
        SELECT id, symbol, timeframe, direction, ts_entry
        FROM paper_trades WHERE status='OPEN'
        AND julianday('now') - julianday(substr(ts_entry, 1, 10)) >= 5
    """).fetchall()
    if stale:
        for s in stale:
            age = (now.date() - datetime.fromisoformat(s[4][:10]).date()).days
            notice(f"Paper trade #{s[0]} {s[1]} {s[2]} {s[3]} OPEN {age} days")

    conn.close()


def build_report():
    run()
    now = datetime.now(timezone.utc)
    lines = [f"\U0001F50D EOD Data Quality Check — {now.strftime('%Y-%m-%d')}", ""]
    if ISSUES:
        lines.append(f"Issues Found ({len(ISSUES)}):")
        lines.extend(ISSUES)
        lines.append("")
    if NOTICES:
        lines.append("Status:")
        lines.extend(NOTICES)
    if not ISSUES:
        lines.append("")
        lines.append("No critical issues found.")
    return "\n".join(lines)


if __name__ == "__main__":
    print(build_report())
