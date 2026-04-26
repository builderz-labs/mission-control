"""Killzone /api/roadmap endpoint.

Reads docs/roadmap.yaml from the repo root and returns it as JSON. Cached
for 60 seconds — edits in repo show up promptly without hammering disk.

Source of truth lives in docs/roadmap.yaml. Edits go through git, never
through the API.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("killzone.roadmap")

# Resolve roadmap.yaml in the same way the API resolves engine/version.py:
# walk up from __file__, fall back to ROCEOS_REPO env var.
def _find_roadmap() -> Path:
    parents = Path(__file__).resolve().parents
    for p in parents:
        candidate = p / "docs" / "roadmap.yaml"
        if candidate.exists():
            return candidate
    repo = Path(os.getenv("ROCEOS_REPO", "/docker/roce-os"))
    return repo / "docs" / "roadmap.yaml"


ROADMAP_FILE = _find_roadmap()
_CACHE: dict = {"data": None, "loaded_at": 0.0, "mtime": 0.0}
_CACHE_TTL_SEC = 60

router = APIRouter(prefix="/api/roadmap", tags=["roadmap"])


def _load() -> dict:
    if not ROADMAP_FILE.exists():
        raise HTTPException(status_code=503, detail=f"roadmap.yaml not found at {ROADMAP_FILE}")

    mtime = ROADMAP_FILE.stat().st_mtime
    age = time.time() - _CACHE["loaded_at"]
    if _CACHE["data"] is not None and age < _CACHE_TTL_SEC and mtime == _CACHE["mtime"]:
        return _CACHE["data"]

    try:
        data = yaml.safe_load(ROADMAP_FILE.read_text())
    except yaml.YAMLError as e:
        raise HTTPException(status_code=500, detail=f"roadmap.yaml is invalid: {e}")

    if not isinstance(data, dict) or "tracks" not in data:
        raise HTTPException(status_code=500, detail="roadmap.yaml missing 'tracks' key")

    _CACHE.update(data=data, loaded_at=time.time(), mtime=mtime)
    return data


def _filter_tracks(tracks: list, is_admin: bool) -> list:
    """Remove system: roceos tracks from public view."""
    if is_admin:
        return tracks
    return [t for t in tracks if t.get("system") != "roceos"]


@router.get("")
async def get_roadmap(request: Request):
    from auth import get_current_user
    user   = get_current_user(request)
    is_admin = bool(user and user.get("role") == "admin")

    data   = _load()
    tracks = _filter_tracks(data["tracks"], is_admin)
    summary = {
        "track_count": len(tracks),
        "phase_count": sum(len(t.get("phases", [])) for t in tracks),
        "by_status": {},
    }
    for t in tracks:
        for p in t.get("phases", []):
            s = p.get("status", "unknown")
            summary["by_status"][s] = summary["by_status"].get(s, 0) + 1
    return {"summary": summary, "tracks": tracks, "source": str(ROADMAP_FILE)}


@router.get("/{track_id}")
async def get_track(track_id: str, request: Request):
    from auth import get_current_user
    user     = get_current_user(request)
    is_admin = bool(user and user.get("role") == "admin")

    data = _load()
    for t in data["tracks"]:
        if t["id"] == track_id:
            if t.get("system") == "roceos" and not is_admin:
                raise HTTPException(status_code=403, detail="admin required for this track")
            return t
    raise HTTPException(status_code=404, detail=f"track {track_id!r} not found")
