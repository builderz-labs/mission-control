"""Signal service database — pairing tokens and agent registry."""

import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger("signal_db")

# Use the same trading DB for simplicity
DB_PATH = Path(
    __file__).parent.parent / "trading.db"  # fallback
import os
_db_override = os.environ.get("TRADING_DB_PATH")
if _db_override:
    DB_PATH = Path(_db_override)


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_signal_tables():
    """Create signal service tables if they don't exist."""
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS pairing_tokens (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        consumed    INTEGER DEFAULT 0,
        consumed_at TEXT
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
    """)
    conn.commit()
    conn.close()
    logger.info("Signal tables initialized")


def create_pairing_token(token: str, user_id: str, display_name: str,
                         expiry_hours: int = 48):
    """Store a new pairing token."""
    conn = get_conn()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=expiry_hours)
    conn.execute(
        "INSERT INTO pairing_tokens (token, user_id, display_name, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (token, user_id, display_name, now.isoformat(), expires.isoformat())
    )
    conn.commit()
    conn.close()


def consume_pairing_token(token: str) -> dict | None:
    """Validate and consume a pairing token. Returns user info or None."""
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

    now = datetime.now(timezone.utc)
    expires = datetime.fromisoformat(row["expires_at"])
    if now > expires:
        conn.close()
        logger.warning(f"Pairing token expired for {row['user_id']}")
        return None

    # Consume it
    conn.execute(
        "UPDATE pairing_tokens SET consumed=1, consumed_at=? WHERE token=?",
        (now.isoformat(), token)
    )
    conn.commit()
    conn.close()

    return {"user_id": row["user_id"], "display_name": row["display_name"]}


def register_agent(user_id: str, display_name: str, jwt_hash: str,
                   hostname: str = None, agent_version: str = None):
    """Register or update an agent."""
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
    """Update last_seen timestamp."""
    conn = get_conn()
    conn.execute(
        "UPDATE agents SET last_seen=? WHERE user_id=?",
        (datetime.now(timezone.utc).isoformat(), user_id)
    )
    conn.commit()
    conn.close()


def is_agent_active(user_id: str) -> bool:
    """Check if an agent is active (not revoked)."""
    conn = get_conn()
    row = conn.execute(
        "SELECT active FROM agents WHERE user_id=?", (user_id,)
    ).fetchone()
    conn.close()
    return bool(row and row["active"])


def revoke_agent(user_id: str):
    """Deactivate an agent."""
    conn = get_conn()
    conn.execute("UPDATE agents SET active=0 WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()
    logger.info(f"Agent revoked: {user_id}")


def list_agents() -> list[dict]:
    """List all agents."""
    conn = get_conn()
    rows = conn.execute("SELECT * FROM agents ORDER BY created_at").fetchall()
    conn.close()
    return [dict(r) for r in rows]
