"""Discord OAuth2 authentication for Killzone Dashboard.

Flow:
  GET /api/auth/discord          → redirect to Discord authorization
  GET /api/auth/discord/callback → exchange code, upsert user, set session cookie, redirect to dashboard

Env vars required:
  DISCORD_CLIENT_ID       — OAuth2 Application → Client ID
  DISCORD_CLIENT_SECRET   — OAuth2 Application → Client Secret

Env vars optional:
  DISCORD_REDIRECT_URI    — default https://api.ictwealthbuilding.com/api/auth/discord/callback
  DISCORD_GUILD_ID        — if set, user must be in this server or they get 'not_in_guild' error
  DISCORD_ADMIN_IDS       — comma-separated Discord user IDs that get the admin role
  DASHBOARD_URL           — where to redirect after login (default https://dashboard.ictwealthbuilding.com)
"""

import logging
import os
import secrets
import sqlite3
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from auth import _get_conn, _create_session, _set_session_cookie, init_auth_tables

logger = logging.getLogger("killzone.discord_auth")

router = APIRouter()

DISCORD_CLIENT_ID     = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI  = os.getenv(
    "DISCORD_REDIRECT_URI",
    "https://api.ictwealthbuilding.com/api/auth/discord/callback",
)
DISCORD_GUILD_ID   = os.getenv("DISCORD_GUILD_ID", "")
DISCORD_ADMIN_IDS  = set(filter(None, os.getenv("DISCORD_ADMIN_IDS", "").split(",")))
DASHBOARD_URL      = os.getenv("DASHBOARD_URL", "https://dashboard.ictwealthbuilding.com")

# In-memory CSRF state store — single-process deploy, no Redis needed
_pending_states: set[str] = set()


# ── DB migration ──────────────────────────────────────────────────────────────

def migrate_discord_columns() -> None:
    """Add Discord columns to users table if they don't exist yet. Idempotent."""
    init_auth_tables()
    conn = _get_conn()
    try:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        additions = {
            "discord_id":       "TEXT",
            "discord_username": "TEXT",
            "discord_avatar":   "TEXT",
            "auth_method":      "TEXT NOT NULL DEFAULT 'password'",
        }
        for col, typedef in additions.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {typedef}")
                conn.commit()
                logger.info(f"Added column users.{col}")
    except Exception as e:
        logger.error(f"Discord migration error: {e}")
    finally:
        conn.close()


# ── OAuth routes ──────────────────────────────────────────────────────────────

@router.get("/api/auth/discord")
async def discord_login():
    """Redirect browser to Discord authorization page."""
    if not DISCORD_CLIENT_ID:
        return RedirectResponse(f"{DASHBOARD_URL}/login?error=discord_not_configured")

    state = secrets.token_hex(16)
    _pending_states.add(state)

    scopes = "identify guilds" if DISCORD_GUILD_ID else "identify"
    auth_url = (
        "https://discord.com/oauth2/authorize"
        f"?client_id={DISCORD_CLIENT_ID}"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={scopes.replace(' ', '%20')}"
        f"&state={state}"
    )
    return RedirectResponse(auth_url)


@router.get("/api/auth/discord/callback")
async def discord_callback(code: str = None, state: str = None, error: str = None):
    """Handle Discord OAuth2 callback. Creates session, redirects to dashboard."""
    if error:
        return RedirectResponse(f"{DASHBOARD_URL}/login?error=discord_denied")

    if not code or state not in _pending_states:
        return RedirectResponse(f"{DASHBOARD_URL}/login?error=invalid_state")

    _pending_states.discard(state)

    async with httpx.AsyncClient(timeout=10) as client:
        # Exchange authorization code for access token
        token_resp = await client.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id":     DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not token_resp.is_success:
            logger.error(f"Discord token exchange failed: {token_resp.text}")
            return RedirectResponse(f"{DASHBOARD_URL}/login?error=token_exchange_failed")

        access_token = token_resp.json()["access_token"]
        bearer = {"Authorization": f"Bearer {access_token}"}

        # Fetch Discord user profile
        user_resp = await client.get("https://discord.com/api/users/@me", headers=bearer)
        if not user_resp.is_success:
            return RedirectResponse(f"{DASHBOARD_URL}/login?error=user_fetch_failed")

        discord_user     = user_resp.json()
        discord_id       = discord_user["id"]
        discord_username = discord_user.get("global_name") or discord_user["username"]
        avatar_hash      = discord_user.get("avatar")
        discord_avatar   = (
            f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png"
            if avatar_hash else None
        )

        # Optional: require membership in a specific guild
        if DISCORD_GUILD_ID:
            guilds_resp = await client.get("https://discord.com/api/users/@me/guilds", headers=bearer)
            if guilds_resp.is_success:
                guild_ids = {g["id"] for g in guilds_resp.json()}
                if DISCORD_GUILD_ID not in guild_ids:
                    logger.warning(f"Discord user {discord_id} ({discord_username}) not in required guild {DISCORD_GUILD_ID}")
                    return RedirectResponse(f"{DASHBOARD_URL}/login?error=not_in_guild")

    # Determine role — admin if in DISCORD_ADMIN_IDS, else viewer
    new_role = "admin" if discord_id in DISCORD_ADMIN_IDS else "viewer"

    # Upsert user row
    conn = _get_conn()
    try:
        now      = datetime.now(timezone.utc).isoformat()
        username = f"discord_{discord_id}"

        existing = conn.execute(
            "SELECT id, role FROM users WHERE discord_id=?", (discord_id,)
        ).fetchone()

        if existing:
            # Preserve existing admin role — never demote an admin via OAuth
            if existing["role"] == "admin":
                new_role = "admin"
            conn.execute(
                "UPDATE users SET discord_username=?, discord_avatar=?, auth_method='discord', role=? WHERE discord_id=?",
                (discord_username, discord_avatar, new_role, discord_id),
            )
            user_id = existing["id"]
        else:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, role, created_at, discord_id, discord_username, discord_avatar, auth_method) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (username, "discord", new_role, now, discord_id, discord_username, discord_avatar, "discord"),
            )
            user_id = cursor.lastrowid

        conn.commit()
    except sqlite3.IntegrityError as e:
        logger.error(f"DB error creating Discord user {discord_id}: {e}")
        conn.close()
        return RedirectResponse(f"{DASHBOARD_URL}/login?error=db_error")
    finally:
        conn.close()

    session_id = _create_session(user_id)
    response   = RedirectResponse(f"{DASHBOARD_URL}/")
    _set_session_cookie(response, session_id)

    logger.info(f"Discord login: {discord_username} ({discord_id}) role={new_role}")
    return response
