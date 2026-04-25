"""Killzone /api/health/detailed endpoint.

Returns the JSON written by /opt/scripts/system_health.sh — the canonical
self-heal report. Routines (morning briefing, etc.) should curl this
instead of running their own checks.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

STATUS_FILE = Path(os.getenv("HEALTH_STATUS_FILE", "/var/lib/system-health/status.json"))

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/detailed")
async def detailed():
    """Latest output of /opt/scripts/system_health.sh.

    Frontends/routines should treat overall=='red' as the trigger for
    surfacing action_items. Self-healed checks live in `healed` and are
    informational only.
    """
    if not STATUS_FILE.exists():
        raise HTTPException(
            status_code=503,
            detail=f"{STATUS_FILE} not found — has system_health.sh ever run?",
        )
    try:
        return json.loads(STATUS_FILE.read_text())
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"corrupt status file: {e}")
