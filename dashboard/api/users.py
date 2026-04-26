"""Killzone Dashboard — User management API (admin only).

Endpoints:
  GET  /api/users                       — list all agents + live status
  POST /api/users                       — create user + generate pairing token
  POST /api/users/{user_id}/regenerate  — revoke old tokens, issue new pairing token
  DELETE /api/users/{user_id}           — revoke agent access
  PATCH /api/users/{user_id}/entitlement — update entitlement caps
  GET  /api/users/{user_id}/trades      — trade history for a user
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from auth import require_admin
from signal_service.auth import generate_pairing_token
from signal_service.db import (
    init_signal_tables,
    create_pairing_token,
    list_agents,
    revoke_agent,
    is_agent_active,
    get_entitlement,
    log_audit,
    get_conn,
)
from signal_service.connection_manager import manager

logger = logging.getLogger("killzone.users")

router = APIRouter()


# ── List users ────────────────────────────────────────────────────────────────

@router.get("/api/users")
async def list_users(request: Request):
    """List all registered agents with live connection status and entitlement."""
    require_admin(request)
    init_signal_tables()

    agents = list_agents()
    connected = set(manager.connected_users)

    result = []
    for a in agents:
        uid = a["user_id"]
        ent = get_entitlement(uid)
        result.append({
            "user_id":       uid,
            "display_name":  a["display_name"],
            "active":        bool(a["active"]),
            "connected":     uid in connected,
            "last_seen":     a.get("last_seen"),
            "hostname":      a.get("hostname"),
            "agent_version": a.get("agent_version"),
            "created_at":    a.get("created_at"),
            "entitlement": {
                "tier":          ent["tier"],
                "max_contracts": ent["max_contracts"],
                "live_enabled":  ent["live_enabled"],
            },
        })

    return {"users": result, "total": len(result), "connected": len(connected)}


# ── Create user ───────────────────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    user_id: str
    display_name: str


@router.post("/api/users")
async def create_user(body: CreateUserRequest, request: Request):
    """Create a new user and generate their one-time pairing token."""
    require_admin(request)
    init_signal_tables()

    # Prevent duplicate user_ids
    conn = get_conn()
    existing = conn.execute(
        "SELECT user_id FROM agents WHERE user_id=?", (body.user_id,)
    ).fetchone()
    conn.close()
    if existing:
        raise HTTPException(status_code=409, detail=f"User '{body.user_id}' already exists")

    token = generate_pairing_token()
    create_pairing_token(token, body.user_id, body.display_name)
    log_audit("admin", "user_created", f"user_id={body.user_id} display_name={body.display_name}")

    logger.info(f"User created: {body.user_id} ({body.display_name})")

    return {
        "user_id":      body.user_id,
        "display_name": body.display_name,
        "pairing_token": token,
        "expires_in_hours": 48,
        "message": "Send this token to the user — it expires in 48 hours and is single-use.",
    }


# ── Regenerate pairing token ──────────────────────────────────────────────────

@router.post("/api/users/{user_id}/regenerate")
async def regenerate_token(user_id: str, request: Request):
    """Invalidate existing tokens and issue a new pairing token."""
    require_admin(request)
    init_signal_tables()

    if not _user_exists(user_id):
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    # Mark all existing unconsumed tokens consumed so they can't be used
    conn = get_conn()
    conn.execute(
        "UPDATE pairing_tokens SET consumed=1, consumed_at=? WHERE user_id=? AND consumed=0",
        (datetime.now(timezone.utc).isoformat(), user_id),
    )
    conn.commit()
    conn.close()

    token = generate_pairing_token()
    create_pairing_token(token, user_id, _get_display_name(user_id))
    log_audit("admin", "token_regenerated", f"user_id={user_id}")

    logger.info(f"Pairing token regenerated for {user_id}")

    return {
        "user_id":       user_id,
        "pairing_token": token,
        "expires_in_hours": 48,
    }


# ── Revoke user ───────────────────────────────────────────────────────────────

@router.delete("/api/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    """Revoke a user's agent access. Connected agent gets kicked on next auth check."""
    require_admin(request)
    init_signal_tables()

    if not _user_exists(user_id):
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    revoke_agent(user_id)

    # Push force_disconnect if currently connected
    if user_id in manager.connected_users:
        await manager.send_to(user_id, {
            "type": "force_disconnect",
            "message": "Your access has been revoked by the administrator.",
        })

    log_audit("admin", "user_revoked", f"user_id={user_id}")
    logger.info(f"User revoked: {user_id}")

    return {"revoked": True, "user_id": user_id}


# ── Update entitlement ────────────────────────────────────────────────────────

class EntitlementUpdate(BaseModel):
    tier:           Optional[str]  = None
    max_contracts:  Optional[int]  = None
    max_per_day:    Optional[int]  = None
    live_enabled:   Optional[bool] = None
    allowed_symbols:    Optional[list[str]] = None
    allowed_timeframes: Optional[list[str]] = None


@router.patch("/api/users/{user_id}/entitlement")
async def update_entitlement(user_id: str, body: EntitlementUpdate, request: Request):
    """Update a user's entitlement caps. Changes take effect on next WS connect."""
    require_admin(request)
    init_signal_tables()

    if not _user_exists(user_id):
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    import json
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()

    updates = []
    params  = []

    if body.tier           is not None: updates.append("tier=?");            params.append(body.tier)
    if body.max_contracts  is not None: updates.append("max_contracts=?");   params.append(body.max_contracts)
    if body.max_per_day    is not None: updates.append("max_per_day=?");     params.append(body.max_per_day)
    if body.live_enabled   is not None: updates.append("live_enabled=?");    params.append(1 if body.live_enabled else 0)
    if body.allowed_symbols    is not None: updates.append("allowed_symbols=?");    params.append(json.dumps(body.allowed_symbols))
    if body.allowed_timeframes is not None: updates.append("allowed_timeframes=?"); params.append(json.dumps(body.allowed_timeframes))

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at=?")
    params.append(now)
    params.append(user_id)

    conn.execute(
        f"UPDATE entitlements SET {', '.join(updates)} WHERE user_id=?",
        params,
    )
    conn.commit()
    conn.close()

    # Push updated entitlement to connected agent immediately
    updated = get_entitlement(user_id)
    if user_id in manager.connected_users:
        await manager.send_to(user_id, {"type": "entitlement", **updated})
        manager.update_entitlement(user_id, updated)

    log_audit("admin", "entitlement_updated",
              f"user_id={user_id} changes={list(body.model_dump(exclude_none=True).keys())}")

    return {"updated": True, "user_id": user_id, "entitlement": updated}


# ── User trade history ────────────────────────────────────────────────────────

@router.get("/api/users/{user_id}/trades")
async def user_trades(user_id: str, request: Request, limit: int = 50):
    """Trade history for a specific user (admin only)."""
    require_admin(request)

    conn = get_conn()
    rows = conn.execute("""
        SELECT ts_entry, symbol, timeframe, direction, entry_price, exit_price,
               pnl_pts, pnl_futures, status, mode, broker_order_id, notes
        FROM paper_trades
        WHERE account_id=? AND mode='live'
        ORDER BY ts_entry DESC
        LIMIT ?
    """, (user_id, limit)).fetchall()
    conn.close()

    return {
        "user_id": user_id,
        "trades":  [dict(r) for r in rows],
        "total":   len(rows),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _user_exists(user_id: str) -> bool:
    conn = get_conn()
    row = conn.execute("SELECT user_id FROM agents WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row is not None


def _get_display_name(user_id: str) -> str:
    conn = get_conn()
    row = conn.execute("SELECT display_name FROM agents WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row["display_name"] if row else user_id
