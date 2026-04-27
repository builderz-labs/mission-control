"""Killzone Dashboard — Session auth (P1)

Replaces the X-Admin-Token string-match with real session auth:
  scrypt password hashing, HttpOnly session cookies, 30-day TTL.

Tables live in dashboard.db (separate from trading.db / bot.db).

Seed:  set KILLZONE_ADMIN_USER + KILLZONE_ADMIN_PASS env vars. On startup,
       seed_admin() creates the admin user if none exists. Never overwrites
       an existing user — change the password via the CLI or a migration.

FastAPI dependencies:
  get_current_user(request) -> Optional[dict]   — never raises
  require_admin(request)    -> dict              — raises 401/403
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

logger = logging.getLogger("killzone.auth")

# ── Database ──────────────────────────────────────────────────────────────────

_API_DIR = Path(__file__).parent
DASHBOARD_DB = Path(os.getenv("DASHBOARD_DB_PATH", str(_API_DIR / "dashboard.db")))

SESSION_TTL_DAYS = 30
SECURE_COOKIES   = os.getenv("SECURE_COOKIES", "true").lower() == "true"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DASHBOARD_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_auth_tables() -> None:
    conn = _get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'viewer',  -- admin | viewer
        created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        session_id  TEXT PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id         INTEGER PRIMARY KEY REFERENCES users(id),
        position_size   REAL    DEFAULT 1.0,
        min_confidence  INTEGER DEFAULT 80,
        instruments     TEXT    DEFAULT '["ES=F","NQ=F"]',
        kill_zones      TEXT    DEFAULT '["london","ny_am"]',
        r_multiple      REAL    DEFAULT 3.0,
        updated_at      TEXT    NOT NULL
    );
    """)
    conn.commit()
    conn.close()


def seed_admin() -> None:
    """Create the admin user from env vars if no users exist yet.
    Safe to call on every startup — no-ops if a user already exists."""
    init_auth_tables()
    username = os.getenv("KILLZONE_ADMIN_USER", "ross").strip()
    password = os.getenv("KILLZONE_ADMIN_PASS", "").strip()
    if not password:
        logger.warning("KILLZONE_ADMIN_PASS not set — admin user not seeded")
        return

    conn = _get_conn()
    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        conn.close()
        return

    h = _hash_password(password)
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)",
        (username, h, "admin", now),
    )
    user_id = cursor.lastrowid
    conn.execute(
        "INSERT INTO user_settings (user_id, updated_at) VALUES (?,?)",
        (user_id, now),
    )
    # Tag any historical paper_trades with no account_id
    conn.commit()
    conn.close()
    logger.info(f"Admin user '{username}' seeded")


# ── Rate limiting ─────────────────────────────────────────────────────────────

_RATE_WINDOW  = 15 * 60   # 15 minutes
_RATE_MAX     = 5          # max failed attempts per window

# ip -> list of failure timestamps (monotonic)
_login_failures: dict[str, list[float]] = defaultdict(list)


def _check_login_rate(ip: str) -> bool:
    """Return True if this IP is rate-limited (too many recent failures)."""
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW
    attempts = [t for t in _login_failures[ip] if t > cutoff]
    _login_failures[ip] = attempts
    return len(attempts) >= _RATE_MAX


def _record_login_failure(ip: str) -> None:
    _login_failures[ip].append(time.monotonic())


# ── Password hashing ──────────────────────────────────────────────────────────

# Dummy hash used for constant-time comparison when username doesn't exist.
_DUMMY_HASH = None


def _get_dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = _hash_password("dummy-constant-time-placeholder")
    return _DUMMY_HASH


def _hash_password(password: str) -> str:
    salt = os.urandom(32)
    h = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"{salt.hex()}:{h.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, hash_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


# ── Session management ────────────────────────────────────────────────────────

def _create_session(user_id: int) -> str:
    session_id = secrets.token_hex(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SESSION_TTL_DAYS)
    conn = _get_conn()
    conn.execute(
        "INSERT INTO sessions (session_id, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (session_id, user_id, now.isoformat(), expires.isoformat()),
    )
    conn.commit()
    conn.close()
    return session_id


def _get_session_user(session_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("""
        SELECT u.id, u.username, u.role, s.expires_at
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.session_id = ?
    """, (session_id,)).fetchone()
    if not row:
        conn.close()
        return None
    # Check expiry
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            conn.close()
            return None
    except Exception:
        conn.close()
        return None
    # Fetch Discord fields if columns exist (added by discord migration)
    discord_username = discord_avatar = auth_method = None
    try:
        ext = conn.execute(
            "SELECT discord_username, discord_avatar, auth_method FROM users WHERE id=?",
            (row["id"],),
        ).fetchone()
        if ext:
            discord_username = ext["discord_username"]
            discord_avatar   = ext["discord_avatar"]
            auth_method      = ext["auth_method"]
    except Exception:
        pass
    conn.close()
    return {
        "id":               row["id"],
        "username":         row["username"],
        "role":             row["role"],
        "discord_username": discord_username,
        "discord_avatar":   discord_avatar,
        "auth_method":      auth_method or "password",
    }


def _delete_session(session_id: str) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    conn.commit()
    conn.close()


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key="kz_session",
        value=session_id,
        httponly=True,
        secure=SECURE_COOKIES,
        samesite="strict",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key="kz_session", path="/")


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_current_user(request: Request) -> Optional[dict]:
    """Returns the logged-in user dict or None. Never raises."""
    session_id = request.cookies.get("kz_session")
    if not session_id:
        return None
    return _get_session_user(session_id)


def require_admin(request: Request) -> dict:
    """FastAPI dependency — raises 401/403 if not an authenticated admin."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="not authenticated")
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    return user


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    init_auth_tables()

    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() \
         or (request.client.host if request.client else "unknown")

    if _check_login_rate(ip):
        logger.warning(f"Login rate-limited: ip={ip} username={body.username.strip()!r}")
        raise HTTPException(status_code=429, detail="too many failed attempts — try again in 15 minutes")

    conn = _get_conn()
    row = conn.execute(
        "SELECT id, password_hash, role FROM users WHERE username=?",
        (body.username.strip(),),
    ).fetchone()
    conn.close()

    # Always run scrypt to prevent username enumeration via response timing.
    stored = row["password_hash"] if row else _get_dummy_hash()
    ok = _verify_password(body.password, stored) and row is not None

    if not ok:
        _record_login_failure(ip)
        logger.warning(f"Failed login: ip={ip} username={body.username.strip()!r}")
        raise HTTPException(status_code=401, detail="invalid username or password")

    session_id = _create_session(row["id"])
    _set_session_cookie(response, session_id)
    logger.info(f"Login OK: ip={ip} username={body.username.strip()!r} role={row['role']}")
    return {"username": body.username.strip(), "role": row["role"]}


@router.post("/logout")
async def logout(request: Request, response: Response):
    session_id = request.cookies.get("kz_session")
    if session_id:
        _delete_session(session_id)
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    user = get_current_user(request)
    if not user:
        return {"user": None}
    return {"user": {
        "username":         user["username"],
        "role":             user["role"],
        "discord_username": user.get("discord_username"),
        "discord_avatar":   user.get("discord_avatar"),
        "auth_method":      user.get("auth_method", "password"),
    }}


# ── Settings endpoints ────────────────────────────────────────────────────────

settings_router = APIRouter(prefix="/api/settings", tags=["settings"])


@settings_router.get("")
async def get_settings(request: Request):
    user = require_admin(request)
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM user_settings WHERE user_id=?", (user["id"],)
    ).fetchone()
    conn.close()
    if not row:
        return {"position_size": 1.0, "min_confidence": 80,
                "instruments": ["ES=F", "NQ=F"], "kill_zones": ["london", "ny_am"],
                "r_multiple": 3.0}
    import json
    return {
        "position_size":  row["position_size"],
        "min_confidence": row["min_confidence"],
        "instruments":    json.loads(row["instruments"] or "[]"),
        "kill_zones":     json.loads(row["kill_zones"] or "[]"),
        "r_multiple":     row["r_multiple"],
    }


class SettingsPatch(BaseModel):
    position_size:  Optional[float] = None
    min_confidence: Optional[int]   = None
    instruments:    Optional[list]  = None
    kill_zones:     Optional[list]  = None
    r_multiple:     Optional[float] = None


@settings_router.patch("")
async def patch_settings(body: SettingsPatch, request: Request):
    import json
    user = require_admin(request)
    now  = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()

    existing = conn.execute(
        "SELECT * FROM user_settings WHERE user_id=?", (user["id"],)
    ).fetchone()

    if not existing:
        conn.execute(
            "INSERT INTO user_settings (user_id, updated_at) VALUES (?,?)",
            (user["id"], now),
        )
        conn.commit()

    updates = {}
    if body.position_size  is not None: updates["position_size"]  = body.position_size
    if body.min_confidence is not None: updates["min_confidence"] = body.min_confidence
    if body.instruments    is not None: updates["instruments"]    = json.dumps(body.instruments)
    if body.kill_zones     is not None: updates["kill_zones"]     = json.dumps(body.kill_zones)
    if body.r_multiple     is not None: updates["r_multiple"]     = body.r_multiple

    if updates:
        updates["updated_at"] = now
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values()) + [user["id"]]
        conn.execute(f"UPDATE user_settings SET {sets} WHERE user_id=?", vals)
        conn.commit()

    conn.close()
    return {"ok": True}
