"""Killzone — Scanner threshold configuration API (admin only).

Lets you tune scanner thresholds without touching code or restarting services.
Changes take effect on the next scanner run (cron or webhook trigger).

Endpoints:
  GET  /api/scanner/config        — current values + defaults
  PATCH /api/scanner/config       — update one or more thresholds
  POST /api/scanner/config/reset  — reset all to defaults
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from auth import require_admin
from signal_service.db import get_conn

logger = logging.getLogger("killzone.scanner_config")

router = APIRouter(prefix="/api/scanner/config", tags=["scanner_config"])

_DEFAULTS = {
    "fvg_proximity":           0.0025,
    "fvg_lookback":            21,
    "min_rr":                  1.5,
    "max_open_per_instrument": 2,
    "max_daily_losses":        3,
}

_DESCRIPTIONS = {
    "fvg_proximity":           "Price must be within this fraction of the FVG midpoint (0.0025 = 0.25%)",
    "fvg_lookback":            "Candles to search back for an unmitigated FVG (Gameplan: 21)",
    "min_rr":                  "Minimum R:R to generate a signal — trades below stay HOLD",
    "max_open_per_instrument": "Max concurrent open paper trades per instrument across all timeframes",
    "max_daily_losses":        "Losses on one instrument in a single day before halting that instrument",
}


def _get_trading_conn():
    """Connect to trading.db via signal_service path (same DB the scanner uses)."""
    return get_conn()


def _init_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scanner_config (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()


def _read_config(conn) -> dict:
    rows = conn.execute("SELECT key, value FROM scanner_config").fetchall()
    cfg  = {}
    for row in rows:
        k, v = row["key"], row["value"]
        if k in _DEFAULTS:
            cfg[k] = type(_DEFAULTS[k])(v)
    return cfg


@router.get("")
async def get_config(request: Request):
    """Return current scanner thresholds with defaults and descriptions."""
    require_admin(request)
    conn = _get_trading_conn()
    _init_table(conn)
    stored = _read_config(conn)
    conn.close()

    fields = {}
    for k, default in _DEFAULTS.items():
        fields[k] = {
            "value":       stored.get(k, default),
            "default":     default,
            "description": _DESCRIPTIONS[k],
            "customized":  k in stored,
        }
    return {"config": fields}


class ConfigPatch(BaseModel):
    fvg_proximity:           Optional[float] = None
    fvg_lookback:            Optional[int]   = None
    min_rr:                  Optional[float] = None
    max_open_per_instrument: Optional[int]   = None
    max_daily_losses:        Optional[int]   = None

    @field_validator("fvg_proximity")
    @classmethod
    def _prox_range(cls, v):
        if v is not None and not (0.0001 <= v <= 0.05):
            raise ValueError("fvg_proximity must be between 0.0001 (0.01%) and 0.05 (5%)")
        return v

    @field_validator("fvg_lookback")
    @classmethod
    def _lookback_range(cls, v):
        if v is not None and not (5 <= v <= 100):
            raise ValueError("fvg_lookback must be between 5 and 100")
        return v

    @field_validator("min_rr")
    @classmethod
    def _rr_range(cls, v):
        if v is not None and not (0.5 <= v <= 10.0):
            raise ValueError("min_rr must be between 0.5 and 10.0")
        return v

    @field_validator("max_open_per_instrument")
    @classmethod
    def _open_range(cls, v):
        if v is not None and not (1 <= v <= 10):
            raise ValueError("max_open_per_instrument must be between 1 and 10")
        return v

    @field_validator("max_daily_losses")
    @classmethod
    def _losses_range(cls, v):
        if v is not None and not (1 <= v <= 20):
            raise ValueError("max_daily_losses must be between 1 and 20")
        return v


@router.patch("")
async def patch_config(body: ConfigPatch, request: Request):
    """Update one or more scanner thresholds. Takes effect on the next scan run."""
    require_admin(request)

    from datetime import datetime, timezone
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    now  = datetime.now(timezone.utc).isoformat()
    conn = _get_trading_conn()
    _init_table(conn)

    for k, v in updates.items():
        conn.execute(
            "INSERT INTO scanner_config (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (k, str(v), now),
        )
    conn.commit()

    current = _read_config(conn)
    conn.close()

    logger.info("Scanner config updated: %s", list(updates.keys()))
    return {
        "ok":      True,
        "updated": list(updates.keys()),
        "config":  {k: current.get(k, _DEFAULTS[k]) for k in _DEFAULTS},
    }


@router.post("/reset")
async def reset_config(request: Request):
    """Reset all thresholds to built-in defaults."""
    require_admin(request)
    conn = _get_trading_conn()
    _init_table(conn)
    conn.execute("DELETE FROM scanner_config")
    conn.commit()
    conn.close()
    logger.info("Scanner config reset to defaults")
    return {"ok": True, "config": _DEFAULTS}
