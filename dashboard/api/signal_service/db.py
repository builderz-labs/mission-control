"""Signal service database — pairing tokens, agent registry, entitlements, audit."""

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger("signal_db")

DB_PATH = Path(__file__).parent.parent / "trading.db"
_db_override = os.environ.get("TRADING_DB_PATH")
if _db_override:
    DB_PATH = Path(_db_override)

_DEFAULT_SYMBOLS     = json.dumps(["ES=F", "NQ=F"])
_DEFAULT_TIMEFRAMES  = json.dumps(["15m", "1h"])


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_signal_tables():
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS pairing_tokens (
        token        TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        consumed     INTEGER DEFAULT 0,
        consumed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
        user_id       TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        jwt_hash      TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        last_seen     TEXT,
        hostname      TEXT,
        agent_version TEXT,
        active        INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS entitlements (
        user_id            TEXT    PRIMARY KEY,
        tier               TEXT    NOT NULL DEFAULT 'beta',
        max_contracts      INTEGER NOT NULL DEFAULT 1,
        max_per_day        INTEGER NOT NULL DEFAULT 5,
        allowed_symbols    TEXT    NOT NULL DEFAULT '["ES=F","NQ=F"]',
        allowed_timeframes TEXT    NOT NULL DEFAULT '["15m","1h"]',
        live_enabled       INTEGER NOT NULL DEFAULT 0,
        expires_at         TEXT,
        updated_at         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT    NOT NULL,
        action  TEXT    NOT NULL,
        detail  TEXT,
        ts      TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts   ON audit_log(ts);

    CREATE TABLE IF NOT EXISTS agent_metrics (
        user_id          TEXT    PRIMARY KEY,
        connects         INTEGER DEFAULT 0,
        disconnects      INTEGER DEFAULT 0,
        trades_attempted INTEGER DEFAULT 0,
        last_error       TEXT,
        updated_at       TEXT
    );
    """)
    conn.commit()
    conn.close()
    logger.info("Signal tables initialized")


# ── Pairing tokens ────────────────────────────────────────────────────────────

def create_pairing_token(token: str, user_id: str, display_name: str,
                         expiry_hours: int = 48):
    conn = get_conn()
    now     = datetime.now(timezone.utc)
    expires = now + timedelta(hours=expiry_hours)
    conn.execute(
        "INSERT INTO pairing_tokens (token, user_id, display_name, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (token, user_id, display_name, now.isoformat(), expires.isoformat()),
    )
    conn.commit()
    conn.close()


def consume_pairing_token(token: str) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM pairing_tokens WHERE token=?", (token,)
    ).fetchone()

    if not row:
        conn.close()
        return None
    if row["consumed"]:
        conn.close()
        logger.warning(f"Pairing token already consumed for {row['user_id']}")
        return None

    now     = datetime.now(timezone.utc)
    expires = datetime.fromisoformat(row["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        conn.close()
        logger.warning(f"Pairing token expired for {row['user_id']}")
        return None

    conn.execute(
        "UPDATE pairing_tokens SET consumed=1, consumed_at=? WHERE token=?",
        (now.isoformat(), token),
    )
    conn.commit()
    conn.close()
    return {"user_id": row["user_id"], "display_name": row["display_name"]}


# ── Agent registry ────────────────────────────────────────────────────────────

def register_agent(user_id: str, display_name: str, jwt_hash: str,
                   hostname: str = None, agent_version: str = None):
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT INTO agents (user_id, display_name, jwt_hash, created_at, last_seen, hostname, agent_version)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            jwt_hash=excluded.jwt_hash,
            last_seen=excluded.last_seen,
            hostname=excluded.hostname,
            agent_version=excluded.agent_version,
            active=1
    """, (user_id, display_name, jwt_hash, now, now, hostname, agent_version))
    conn.commit()
    conn.close()


def update_agent_last_seen(user_id: str):
    conn = get_conn()
    conn.execute(
        "UPDATE agents SET last_seen=? WHERE user_id=?",
        (datetime.now(timezone.utc).isoformat(), user_id),
    )
    conn.commit()
    conn.close()


def is_agent_active(user_id: str) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT active FROM agents WHERE user_id=?", (user_id,)
    ).fetchone()
    conn.close()
    return bool(row and row["active"])


def revoke_agent(user_id: str):
    conn = get_conn()
    conn.execute("UPDATE agents SET active=0 WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()
    logger.info(f"Agent revoked: {user_id}")


def restore_agent(user_id: str):
    conn = get_conn()
    conn.execute("UPDATE agents SET active=1 WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()
    logger.info(f"Agent restored: {user_id}")


def list_agents() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM agents ORDER BY created_at").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Entitlements ──────────────────────────────────────────────────────────────

_BETA_DEFAULTS = {
    "tier":               "beta",
    "max_contracts":      1,
    "max_per_day":        5,
    "allowed_symbols":    ["ES=F", "NQ=F"],
    "allowed_timeframes": ["15m", "1h"],
    "live_enabled":       False,
    "expires_at":         None,
}


def get_entitlement(user_id: str) -> dict:
    """Return entitlement for user, falling back to beta defaults if not set."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM entitlements WHERE user_id=?", (user_id,)
    ).fetchone()
    conn.close()
    if not row:
        return dict(_BETA_DEFAULTS)
    return {
        "tier":               row["tier"],
        "max_contracts":      row["max_contracts"],
        "max_per_day":        row["max_per_day"],
        "allowed_symbols":    json.loads(row["allowed_symbols"]),
        "allowed_timeframes": json.loads(row["allowed_timeframes"]),
        "live_enabled":       bool(row["live_enabled"]),
        "expires_at":         row["expires_at"],
    }


def seed_entitlement(user_id: str):
    """Create beta entitlement row for a new user if none exists yet."""
    conn = get_conn()
    existing = conn.execute(
        "SELECT user_id FROM entitlements WHERE user_id=?", (user_id,)
    ).fetchone()
    if not existing:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("""
            INSERT INTO entitlements
            (user_id, tier, max_contracts, max_per_day, allowed_symbols, allowed_timeframes, live_enabled, updated_at)
            VALUES (?, 'beta', 1, 5, ?, ?, 0, ?)
        """, (user_id, _DEFAULT_SYMBOLS, _DEFAULT_TIMEFRAMES, now))
        conn.commit()
    conn.close()


def set_live_enabled(user_id: str, enabled: bool):
    """Ross flips this per user after reviewing demo performance."""
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE entitlements SET live_enabled=?, updated_at=? WHERE user_id=?",
        (1 if enabled else 0, now, user_id),
    )
    conn.commit()
    conn.close()
    logger.info(f"live_enabled={'True' if enabled else 'False'} for {user_id}")


# ── Audit log ─────────────────────────────────────────────────────────────────

def log_audit(user_id: str, action: str, detail: str = None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO audit_log (user_id, action, detail, ts) VALUES (?, ?, ?, ?)",
        (user_id, action, detail, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


# ── Agent metrics ─────────────────────────────────────────────────────────────

def bump_metric(user_id: str, field: str, error: str = None):
    """Increment a named counter for an agent."""
    allowed = {"connects", "disconnects", "trades_attempted"}
    if field not in allowed:
        return
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()
    if error:
        conn.execute(f"""
            INSERT INTO agent_metrics (user_id, {field}, last_error, updated_at)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                {field}={field}+1, last_error=excluded.last_error, updated_at=excluded.updated_at
        """, (user_id, error, now))
    else:
        conn.execute(f"""
            INSERT INTO agent_metrics (user_id, {field}, updated_at)
            VALUES (?, 1, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                {field}={field}+1, updated_at=excluded.updated_at
        """, (user_id, now))
    conn.commit()
    conn.close()
