"""Killzone /api/proposals endpoints.

Read endpoints are public (will be session-gated in P1). Write endpoints
(/decide, /assess) require the X-Admin-Token header to match the
KILLZONE_ADMIN_TOKEN environment variable. If the env var is unset, all
writes are refused (fail closed).

Backed by /docker/roce-os/bots/discord/bot.db on VPS, sqlite.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger("killzone.proposals")

BOT_DB = Path(os.getenv("BOT_DB_PATH", "/docker/roce-os/bots/discord/bot.db"))
ADMIN_TOKEN = os.getenv("KILLZONE_ADMIN_TOKEN", "").strip()

router = APIRouter(prefix="/api/proposals", tags=["proposals"])


def _conn() -> sqlite3.Connection:
    if not BOT_DB.exists():
        raise HTTPException(status_code=503, detail=f"bot.db not found at {BOT_DB}")
    c = sqlite3.connect(BOT_DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    # Surface the legacy `description` field as `body` for cleaner UI naming
    if "description" in d:
        d["body"] = d.pop("description")
    return d


def _require_admin(token: Optional[str]) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="admin token not configured on server")
    if not token or token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="invalid admin token")


# ── Read endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_proposals(
    status: Literal["pending", "approved", "rejected", "all"] = Query("all"),
    limit: int = Query(50, ge=1, le=500),
):
    sql = "SELECT * FROM proposals"
    params: tuple = ()
    if status == "pending":
        sql += " WHERE status='pending' OR ross_decision IS NULL"
    elif status == "approved":
        sql += " WHERE ross_decision='APPROVED'"
    elif status == "rejected":
        sql += " WHERE ross_decision='REJECTED'"
    sql += " ORDER BY id DESC LIMIT ?"
    params = (limit,)

    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    return {"proposals": [_row_to_dict(r) for r in rows], "count": len(rows)}


@router.get("/{proposal_id}")
async def get_proposal(proposal_id: int):
    with _conn() as c:
        row = c.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"proposal {proposal_id} not found")
    return _row_to_dict(row)


# ── Write endpoints ───────────────────────────────────────────────────────────

class DecisionPayload(BaseModel):
    decision: Literal["APPROVED", "REJECTED", "REVISE"]
    notes: Optional[str] = Field(None, max_length=2000)


@router.post("/{proposal_id}/decide")
async def decide_proposal(
    proposal_id: int,
    payload: DecisionPayload,
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
):
    _require_admin(x_admin_token)

    now = datetime.now(timezone.utc).isoformat()
    new_status = {
        "APPROVED": "approved",
        "REJECTED": "rejected",
        "REVISE": "needs_revision",
    }[payload.decision]
    impl_status = "queued" if payload.decision == "APPROVED" else None

    with _conn() as c:
        cur = c.execute(
            """UPDATE proposals
               SET ross_decision = ?, ross_decided_at = ?, ross_notes = ?,
                   status = ?, implementation_status = COALESCE(?, implementation_status)
               WHERE id = ?""",
            (payload.decision, now, payload.notes, new_status, impl_status, proposal_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"proposal {proposal_id} not found")
        c.commit()
        row = c.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()

    logger.info(f"Proposal {proposal_id} {payload.decision} by admin")
    return {"ok": True, "proposal": _row_to_dict(row)}


class AssessmentPayload(BaseModel):
    """Used to set Claude's recommendation manually OR via webhook from Captain Hook.
    The actual LLM call lives outside the API for now (Phase: assessment worker)."""
    recommendation: Literal["APPROVE", "REJECT", "MODIFY"]
    reasoning: str = Field(..., min_length=10, max_length=10000)


@router.post("/{proposal_id}/assess")
async def set_assessment(
    proposal_id: int,
    payload: AssessmentPayload,
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
):
    _require_admin(x_admin_token)

    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        cur = c.execute(
            """UPDATE proposals
               SET claude_recommendation = ?, claude_reasoning = ?, claude_assessed_at = ?
               WHERE id = ?""",
            (payload.recommendation, payload.reasoning, now, proposal_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"proposal {proposal_id} not found")
        c.commit()
        row = c.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()

    logger.info(f"Proposal {proposal_id} assessed: {payload.recommendation}")
    return {"ok": True, "proposal": _row_to_dict(row)}
