"""
Trading Database — SQLite
Central store for all signals, alerts, trades, and outcomes.

Tables:
  signals   — every hourly/15m/daily check, all conditions, pass/fail
  alerts    — subset of signals that met threshold (posted to Discord)
  trades    — actual executed trades (crypto live bot)
  outcomes  — manual or auto-tracked outcome of alerts (win/loss/missed)
"""

import sqlite3
import os
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("trading_db")

DB_PATH = Path(os.environ.get("TRADING_DB_PATH", str(Path(__file__).parent / "trading.db")))


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    """Create tables if they don't exist."""
    conn = get_conn()
    c = conn.cursor()

    c.executescript("""
    CREATE TABLE IF NOT EXISTS signals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ts            TEXT NOT NULL,              -- ISO timestamp UTC
        symbol        TEXT NOT NULL,              -- ES=F, NQ=F, BTC/USD, etc.
        timeframe     TEXT NOT NULL,              -- 15m, 1h, 4h, 1d
        price         REAL,
        signal        TEXT NOT NULL,              -- ALERT or HOLD
        confidence    INTEGER,                    -- 0-100
        passed        INTEGER,                    -- conditions passed (0-5)
        cond_breakout INTEGER,                    -- 1/0
        cond_ema      INTEGER,
        cond_rsi      INTEGER,
        cond_volume   INTEGER,
        cond_killzone INTEGER,
        rsi_val       REAL,
        vol_ratio     REAL,
        atr           REAL,
        source        TEXT                        -- futures_scanner, crypto_scanner, etc.
    );

    CREATE TABLE IF NOT EXISTS alerts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id     INTEGER REFERENCES signals(id),
        ts            TEXT NOT NULL,
        symbol        TEXT NOT NULL,
        timeframe     TEXT NOT NULL,
        price         REAL,
        proxy         TEXT,                       -- SPY, QQQ, etc.
        discord_channel TEXT,                     -- 15m, 1h, daily
        posted        INTEGER DEFAULT 1           -- 1=posted successfully
    );

    CREATE TABLE IF NOT EXISTS trades (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ts            TEXT NOT NULL,
        symbol        TEXT NOT NULL,
        side          TEXT NOT NULL,              -- BUY or SELL
        qty           REAL,
        price         REAL,
        notional      REAL,
        stop_price    REAL,
        exit_price    REAL,
        exit_ts       TEXT,
        exit_reason   TEXT,                       -- STOP, TAKE_PROFIT, TIME_STOP, SESSION_END
        pnl           REAL,
        pnl_pct       REAL,
        account       TEXT,                       -- live, paper
        bot           TEXT                        -- crypto_main, fast_trigger, equities
    );

    CREATE TABLE IF NOT EXISTS outcomes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id      INTEGER REFERENCES alerts(id),
        ts            TEXT NOT NULL,
        result        TEXT,                       -- WIN, LOSS, MISSED, PENDING
        entry_price   REAL,
        exit_price    REAL,
        pnl_pct       REAL,
        notes         TEXT,
        logged_by     TEXT                        -- auto, manual
    );

    CREATE INDEX IF NOT EXISTS idx_signals_ts     ON signals(ts);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
    CREATE INDEX IF NOT EXISTS idx_alerts_ts      ON alerts(ts);
    CREATE INDEX IF NOT EXISTS idx_trades_ts      ON trades(ts);

    CREATE TABLE IF NOT EXISTS smt_divergence (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          TEXT NOT NULL,
        timeframe   TEXT NOT NULL,
        es_signal   TEXT,    -- ALERT or HOLD
        nq_signal   TEXT,
        ym_signal   TEXT,
        es_dir      TEXT,    -- LONG, SHORT, or NULL
        nq_dir      TEXT,
        ym_dir      TEXT,
        es_conf     INTEGER,
        nq_conf     INTEGER,
        ym_conf     INTEGER,
        diverge     INTEGER  -- 1 if YM diverges from ES+NQ consensus, 0 if all aligned
    );

    CREATE INDEX IF NOT EXISTS idx_smt_div_ts ON smt_divergence(ts);
    CREATE INDEX IF NOT EXISTS idx_smt_div_tf ON smt_divergence(timeframe);
    """)

    conn.commit()
    conn.close()
    print(f"DB initialized: {DB_PATH}")


# ── Writers ───────────────────────────────────────────────────────────────────

def log_signal(symbol, timeframe, price, signal, confidence, passed,
               conditions: dict, atr=None, source=None) -> int:
    """Log a signal check. Returns the signal ID."""
    conn = get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    c = conn.cursor()
    c.execute("""
        INSERT INTO signals
        (ts, symbol, timeframe, price, signal, confidence, passed,
         cond_breakout, cond_ema, cond_rsi, cond_volume, cond_killzone,
         rsi_val, vol_ratio, atr, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        ts, symbol, timeframe, price, signal, confidence, passed,
        int(conditions.get("breakout", {}).get("pass", 0)),
        int(conditions.get("ema",      {}).get("pass", 0)),
        int(conditions.get("rsi",      {}).get("pass", 0)),
        int(conditions.get("volume",   {}).get("pass", 0)),
        int(conditions.get("kill_zone",{}).get("pass", 0)),
        conditions.get("rsi",    {}).get("val"),
        conditions.get("volume", {}).get("ratio"),
        atr, source,
    ))
    signal_id = c.lastrowid
    conn.commit()
    conn.close()
    return signal_id


def log_alert(signal_id, symbol, timeframe, price, proxy=None,
              discord_channel=None, posted=True) -> int:
    """Log a Discord alert. Returns alert ID."""
    conn = get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    c = conn.cursor()
    c.execute("""
        INSERT INTO alerts (signal_id, ts, symbol, timeframe, price, proxy, discord_channel, posted)
        VALUES (?,?,?,?,?,?,?,?)
    """, (signal_id, ts, symbol, timeframe, price, proxy, discord_channel, int(posted)))
    alert_id = c.lastrowid
    conn.commit()
    conn.close()
    return alert_id


def log_smt_divergence(timeframe: str, results: dict) -> None:
    """Log SMT divergence snapshot for ES/NQ/YM after each scan pass.

    results: {symbol: sig_dict} — must contain ES=F, NQ=F, YM=F to be useful.
    Diverge = 1 when YM signal/direction differs from the ES+NQ consensus.
    Phase A: data collection only. No signal impact.
    """
    try:
        es  = results.get("ES=F", {})
        nq  = results.get("NQ=F", {})
        ym  = results.get("YM=F", {})

        if not (es and nq and ym):
            return

        es_sig, nq_sig, ym_sig = es.get("signal"), nq.get("signal"), ym.get("signal")
        es_dir = es.get("direction_label") or es.get("sweep_dir")
        nq_dir = nq.get("direction_label") or nq.get("sweep_dir")
        ym_dir = ym.get("direction_label") or ym.get("sweep_dir")

        # Consensus = ES and NQ agree; diverge = YM breaks from that consensus
        es_nq_agree = (es_sig == nq_sig) and (es_dir == nq_dir)
        ym_matches  = (ym_sig == es_sig) and (ym_dir == es_dir)
        diverge     = 1 if (es_nq_agree and not ym_matches) else 0

        conn = get_conn()
        conn.execute(
            """INSERT INTO smt_divergence
               (ts, timeframe, es_signal, nq_signal, ym_signal,
                es_dir, nq_dir, ym_dir, es_conf, nq_conf, ym_conf, diverge)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                datetime.now(timezone.utc).isoformat(), timeframe,
                es_sig, nq_sig, ym_sig,
                es_dir, nq_dir, ym_dir,
                es.get("confidence"), nq.get("confidence"), ym.get("confidence"),
                diverge,
            )
        )
        conn.commit()
        conn.close()
    except Exception as e:
        pass  # never block the scan


def log_trade(symbol, side, qty, price, notional=None, stop_price=None,
              account="live", bot="unknown") -> int:
    """Log a trade entry. Returns trade ID."""
    conn = get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    c = conn.cursor()
    c.execute("""
        INSERT INTO trades (ts, symbol, side, qty, price, notional, stop_price, account, bot)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (ts, symbol, side, qty, price, notional, stop_price, account, bot))
    trade_id = c.lastrowid
    conn.commit()
    conn.close()
    return trade_id


def close_trade(trade_id, exit_price, exit_reason, pnl=None, pnl_pct=None):
    """Update a trade with exit details."""
    conn = get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        UPDATE trades SET exit_price=?, exit_ts=?, exit_reason=?, pnl=?, pnl_pct=?
        WHERE id=?
    """, (exit_price, ts, exit_reason, pnl, pnl_pct, trade_id))
    conn.commit()
    conn.close()


# ── Readers ───────────────────────────────────────────────────────────────────

def recent_signals(symbol=None, timeframe=None, limit=50):
    conn = get_conn()
    q = "SELECT * FROM signals"
    filters, params = [], []
    if symbol:    filters.append("symbol=?");    params.append(symbol)
    if timeframe: filters.append("timeframe=?"); params.append(timeframe)
    if filters: q += " WHERE " + " AND ".join(filters)
    q += f" ORDER BY ts DESC LIMIT {limit}"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return rows


def alert_win_rate(symbol=None, timeframe=None):
    """Calculate win rate from logged outcomes."""
    conn = get_conn()
    q = """
        SELECT result, COUNT(*) as cnt FROM outcomes o
        JOIN alerts a ON o.alert_id = a.id
        WHERE o.result IN ('WIN','LOSS')
    """
    params = []
    if symbol:    q += " AND a.symbol=?";    params.append(symbol)
    if timeframe: q += " AND a.timeframe=?"; params.append(timeframe)
    q += " GROUP BY result"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    results = {r["result"]: r["cnt"] for r in rows}
    total = sum(results.values())
    if total == 0:
        return {"win_rate": None, "wins": 0, "losses": 0, "total": 0}
    return {
        "win_rate": round(results.get("WIN", 0) / total * 100, 1),
        "wins":     results.get("WIN", 0),
        "losses":   results.get("LOSS", 0),
        "total":    total,
    }


def summary():
    """Quick summary of database contents."""
    conn = get_conn()
    signals  = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
    alerts   = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
    trades   = conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    outcomes = conn.execute("SELECT COUNT(*) FROM outcomes").fetchone()[0]
    conn.close()
    return {"signals": signals, "alerts": alerts, "trades": trades, "outcomes": outcomes}


if __name__ == "__main__":
    init_db()
    print("Summary:", summary())


# ── Paper Trades ───────────────────────────────────────────────────────────────

def init_paper_trades():
    """Add paper_trades table if not exists."""
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS paper_trades (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_entry      TEXT NOT NULL,
        symbol        TEXT NOT NULL,
        timeframe     TEXT NOT NULL,
        direction     TEXT NOT NULL,          -- LONG or SHORT
        entry_price   REAL NOT NULL,
        entry_low     REAL,                   -- FVG bottom
        entry_high    REAL,                   -- FVG top
        stop_price    REAL NOT NULL,
        target_price  REAL NOT NULL,
        atr           REAL,
        confidence    INTEGER DEFAULT 100,    -- always 5/5 = 100
        status        TEXT DEFAULT 'OPEN',    -- OPEN, WIN, LOSS, VOID
        ts_exit       TEXT,
        exit_price    REAL,
        pnl_pts       REAL,                   -- points (ES/NQ)
        pnl_futures   REAL,                   -- dollars (MES=$5/pt, MNQ=$2/pt — micro contracts)
        pnl_options   REAL,                   -- conservative options estimate
        rr_actual     REAL,                   -- actual R:R achieved
        alert_id      INTEGER REFERENCES alerts(id),
        notes         TEXT,
        account_id    TEXT DEFAULT 'ross',    -- who owns this trade
        mode          TEXT DEFAULT 'paper',   -- paper or live
        kz_active     INTEGER DEFAULT 0,      -- kill zone active at entry
        broker_order_id TEXT,                  -- external broker order ID (live trades)
        bias_alignment  INTEGER                -- HTF bias aligned count at entry (0-3)
    );
    CREATE INDEX IF NOT EXISTS idx_paper_ts     ON paper_trades(ts_entry);
    CREATE INDEX IF NOT EXISTS idx_paper_status ON paper_trades(status);
    CREATE INDEX IF NOT EXISTS idx_paper_symbol ON paper_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_paper_account ON paper_trades(account_id);
    CREATE INDEX IF NOT EXISTS idx_paper_mode    ON paper_trades(mode);

    -- Trading accounts for multi-user execution
    CREATE TABLE IF NOT EXISTS trading_accounts (
        id            TEXT PRIMARY KEY,       -- ross, greg, ryan
        name          TEXT NOT NULL,          -- display name
        broker        TEXT DEFAULT 'tradovate',
        mode          TEXT DEFAULT 'paper',   -- paper, live, both
        credentials   TEXT,                   -- JSON blob (encrypted)
        risk_config   TEXT,                   -- JSON blob (position cap, daily halt, risk %)
        active        INTEGER DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
    );
    """)
    conn.commit()

    # Migrate existing tables: add new columns if missing (safe to re-run)
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(paper_trades)").fetchall()}
    migrations = {
        "account_id":       "ALTER TABLE paper_trades ADD COLUMN account_id TEXT DEFAULT 'ross'",
        "mode":             "ALTER TABLE paper_trades ADD COLUMN mode TEXT DEFAULT 'paper'",
        "broker_order_id":  "ALTER TABLE paper_trades ADD COLUMN broker_order_id TEXT",
        "bias_alignment":   "ALTER TABLE paper_trades ADD COLUMN bias_alignment INTEGER",
    }
    for col, sql in migrations.items():
        if col not in existing_cols:
            conn.execute(sql)
            logger.info(f"Migrated paper_trades: added {col}")
    conn.commit()
    conn.close()


def log_paper_trade(symbol, timeframe, direction, entry_price, entry_low, entry_high,
                    stop_price, target_price, atr=None, alert_id=None,
                    confidence=None, kz_active=None, notes=None,
                    account_id="ross", mode="paper", broker_order_id=None,
                    bias_alignment=None) -> int:
    """Log a trade entry. Returns trade ID.
    Works for both paper and live trades — mode determines which."""
    init_paper_trades()
    conn = get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    c = conn.cursor()
    c.execute("""
        INSERT INTO paper_trades
        (ts_entry, symbol, timeframe, direction, entry_price, entry_low, entry_high,
         stop_price, target_price, atr, confidence, status, alert_id, kz_active, notes,
         account_id, mode, broker_order_id, bias_alignment)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,?,?)
    """, (ts, symbol, timeframe, direction, entry_price, entry_low, entry_high,
          stop_price, target_price, atr, confidence or 80, alert_id,
          int(kz_active) if kz_active is not None else 0, notes,
          account_id, mode, broker_order_id, bias_alignment))
    trade_id = c.lastrowid
    conn.commit()
    conn.close()
    return trade_id


def resolve_paper_trade(trade_id, exit_price, result, symbol):
    """Close a paper trade with WIN or LOSS."""
    # Point values per contract
    PT_VAL = {"ES=F": 5.0, "NQ=F": 2.0, "YM=F": 0.5}  # MES $5/pt, MNQ $2/pt, MYM $0.50/pt
    pt_val = PT_VAL.get(symbol, 5.0)

    conn = get_conn()
    row = conn.execute("SELECT * FROM paper_trades WHERE id=?", (trade_id,)).fetchone()
    if not row:
        conn.close()
        return

    entry = row["entry_price"]
    stop  = row["stop_price"]
    tgt   = row["target_price"]
    ts_exit = datetime.now(timezone.utc).isoformat()

    pnl_pts     = (exit_price - entry) if row["direction"] == "LONG" else (entry - exit_price)
    pnl_futures = round(pnl_pts * pt_val, 2)

    # Conservative options estimate: 0.30 delta, 1 strike OTM, ~1/3 of futures move
    pnl_options = round(pnl_futures * 0.30, 2)

    risk   = abs(entry - stop)
    reward = abs(exit_price - entry)
    rr_actual = round(reward / risk, 2) if risk > 0 else None

    conn.execute("""
        UPDATE paper_trades SET status=?, ts_exit=?, exit_price=?,
        pnl_pts=?, pnl_futures=?, pnl_options=?, rr_actual=?
        WHERE id=?
    """, (result, ts_exit, exit_price, round(pnl_pts,2),
          pnl_futures, pnl_options, rr_actual, trade_id))
    conn.commit()
    conn.close()


def get_open_paper_trades():
    """Return all OPEN paper trades."""
    init_paper_trades()
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY ts_entry ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Scanner config ────────────────────────────────────────────────────────────

_SCANNER_DEFAULTS = {
    "fvg_proximity":           0.0025,  # 0.25% — price must be within this of FVG midpoint
    "fvg_lookback":            21,      # candles to search for unmitigated FVG
    "min_rr":                  1.5,     # minimum R:R gate (trades below stay HOLD)
    "max_open_per_instrument": 2,       # max concurrent open trades per instrument
    "max_daily_losses":        3,       # losses today on one instrument → halt
}


def _init_scanner_config(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scanner_config (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()


def get_scanner_config() -> dict:
    """Return current scanner thresholds, falling back to defaults for any missing key."""
    conn = get_conn()
    _init_scanner_config(conn)
    rows = conn.execute("SELECT key, value FROM scanner_config").fetchall()
    conn.close()

    cfg = dict(_SCANNER_DEFAULTS)  # start from defaults
    for row in rows:
        k, v = row["key"], row["value"]
        if k not in cfg:
            continue
        default = _SCANNER_DEFAULTS[k]
        cfg[k] = type(default)(v)  # cast to same type as default (int or float)
    return cfg


def set_scanner_config(updates: dict) -> dict:
    """Upsert scanner config keys. Returns the full config after update."""
    conn = get_conn()
    _init_scanner_config(conn)
    now = datetime.now(timezone.utc).isoformat()
    for k, v in updates.items():
        if k not in _SCANNER_DEFAULTS:
            continue
        conn.execute(
            "INSERT INTO scanner_config (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (k, str(v), now),
        )
    conn.commit()
    conn.close()
    return get_scanner_config()


def paper_trade_stats():
    """Win rate, avg R:R, total P&L across all closed paper trades."""
    init_paper_trades()
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM paper_trades WHERE status IN ('WIN','LOSS')"
    ).fetchall()
    conn.close()
    if not rows:
        return {"total": 0, "wins": 0, "losses": 0, "win_rate": None,
                "avg_rr": None, "total_pnl_futures": 0, "total_pnl_options": 0}
    wins   = [r for r in rows if r["status"] == "WIN"]
    losses = [r for r in rows if r["status"] == "LOSS"]
    rr_vals = [r["rr_actual"] for r in rows if r["rr_actual"]]
    return {
        "total":             len(rows),
        "wins":              len(wins),
        "losses":            len(losses),
        "win_rate":          round(len(wins)/len(rows)*100, 1),
        "avg_rr":            round(sum(rr_vals)/len(rr_vals), 2) if rr_vals else None,
        "total_pnl_futures": round(sum(r["pnl_futures"] or 0 for r in rows), 2),
        "total_pnl_options": round(sum(r["pnl_options"] or 0 for r in rows), 2),
        "avg_pnl_futures":   round(sum(r["pnl_futures"] or 0 for r in rows)/len(rows), 2),
    }
