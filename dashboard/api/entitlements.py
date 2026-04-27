"""Killzone — Admin entitlements management API.

Endpoints (admin only):
  GET  /api/entitlements           — list all users with their entitlements
  GET  /api/entitlements/{user_id} — single user
  PATCH /api/entitlements/{user_id} — update tier, limits, live_enabled, expires_at
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import require_admin
from signal_service.db import get_conn, get_entitlement, seed_entitlement
from signal_service.connection_manager import manager

logger = logging.getLogger("killzone.entitlements")

router = APIRouter(prefix="/api/entitlements", tags=["entitlements"])


class EntitlementPatch(BaseModel):
    tier:               Optional[str]   = None
    max_contracts:      Optional[int]   = None
    max_per_day:        Optional[int]   = None
    allowed_symbols:    Optional[list]  = None
    allowed_timeframes: Optional[list]  = None
    live_enabled:       Optional[bool]  = None
    expires_at:         Optional[str]   = None  # ISO8601 or null to clear


@router.get("")
async def list_entitlements(request: Request):
    """List every user_id in entitlements with their current settings."""
    require_admin(request)
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM entitlements ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()

    result = []
    for r in rows:
        ent = get_entitlement(r["user_id"])
        ent["user_id"] = r["user_id"]
        ent["connected"] = r["user_id"] in manager.connected_users
        result.append(ent)

    return {"entitlements": result}


@router.get("/{user_id}")
async def get_user_entitlement(user_id: str, request: Request):
    """Get entitlement for a specific user."""
    require_admin(request)
    ent = get_entitlement(user_id)
    ent["user_id"] = user_id
    ent["connected"] = user_id in manager.connected_users
    return ent


@router.patch("/{user_id}")
async def patch_entitlement(user_id: str, body: EntitlementPatch, request: Request):
    """Update entitlement fields for a user. Creates a beta row if none exists."""
    require_admin(request)
    seed_entitlement(user_id)

    now = datetime.now(timezone.utc).isoformat()
    updates: dict = {}

    if body.tier               is not None: updates["tier"]               = body.tier
    if body.max_contracts      is not None: updates["max_contracts"]      = body.max_contracts
    if body.max_per_day        is not None: updates["max_per_day"]        = body.max_per_day
    if body.allowed_symbols    is not None: updates["allowed_symbols"]    = json.dumps(body.allowed_symbols)
    if body.allowed_timeframes is not None: updates["allowed_timeframes"] = json.dumps(body.allowed_timeframes)
    if body.live_enabled       is not None: updates["live_enabled"]       = 1 if body.live_enabled else 0
    if "expires_at" in body.model_fields_set:
        updates["expires_at"] = body.expires_at  # allow explicit null to clear

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = now
    sets = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [user_id]

    conn = get_conn()
    conn.execute(f"UPDATE entitlements SET {sets} WHERE user_id=?", vals)
    conn.commit()
    conn.close()

    # Live-push updated entitlement to agent if connected
    new_ent = get_entitlement(user_id)
    if user_id in manager.connected_users:
        manager.update_entitlement(user_id, new_ent)
        logger.info(f"Live entitlement update pushed to {user_id}")

    logger.info(f"Entitlement updated for {user_id}: {list(updates.keys())}")
    return {"ok": True, "user_id": user_id, "entitlement": new_ent}
