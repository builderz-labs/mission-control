"""Killzone /api/roadmap endpoint.

Reads docs/roadmap.yaml from the repo root and returns it as JSON. Cached
for 60 seconds — edits in repo show up promptly without hammering disk.

Source of truth lives in docs/roadmap.yaml. Edits go through git, never
through the API.

GitHub issue enrichment: phases with an `issues` list get live open/closed
status fetched from the GitHub API and a `github_progress` field added:
  { total: int, closed: int, pct: int, issues: [{number, title, state, url}] }
Issue data is cached for 5 minutes (separate from YAML cache).
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("killzone.roadmap")

GITHUB_REPO = os.getenv("GITHUB_REPO", "spaceghostroce/roce-os")
_ISSUE_CACHE: dict[int, dict] = {}
_ISSUE_CACHE_AT: float = 0.0
_ISSUE_CACHE_TTL = 300  # 5 minutes


def _fetch_github_issues(numbers: list[int]) -> dict[int, dict]:
    """Fetch open/closed status for a list of issue numbers from GitHub API."""
    global _ISSUE_CACHE, _ISSUE_CACHE_AT
    if _ISSUE_CACHE and time.time() - _ISSUE_CACHE_AT < _ISSUE_CACHE_TTL:
        if all(n in _ISSUE_CACHE for n in numbers):
            return _ISSUE_CACHE

    result: dict[int, dict] = dict(_ISSUE_CACHE)
    try:
        with httpx.Client(timeout=5) as client:
            for n in numbers:
                if n in result and time.time() - _ISSUE_CACHE_AT < _ISSUE_CACHE_TTL:
                    continue
                r = client.get(
                    f"https://api.github.com/repos/{GITHUB_REPO}/issues/{n}",
                    headers={"Accept": "application/vnd.github+json"},
                )
                if r.status_code == 200:
                    d = r.json()
                    result[n] = {
                        "number": n,
                        "title": d.get("title", ""),
                        "state": d.get("state", "open"),
                        "url": d.get("html_url", ""),
                        "milestone": d.get("milestone", {}).get("title") if d.get("milestone") else None,
                    }
        _ISSUE_CACHE = result
        _ISSUE_CACHE_AT = time.time()
    except Exception as e:
        logger.warning(f"GitHub issue fetch failed: {e}")
    return result


def _enrich_phases(tracks: list) -> list:
    """Add github_progress to any phase that has an `issues` list."""
    all_numbers: list[int] = []
    for track in tracks:
        for phase in track.get("phases", []):
            all_numbers.extend(phase.get("issues", []))

    if not all_numbers:
        return tracks

    issue_data = _fetch_github_issues(all_numbers)

    for track in tracks:
        for phase in track.get("phases", []):
            nums = phase.get("issues", [])
            if not nums:
                continue
            issues = [issue_data[n] for n in nums if n in issue_data]
            closed = sum(1 for i in issues if i["state"] == "closed")
            total = len(issues)
            phase["github_progress"] = {
                "total": total,
                "closed": closed,
                "pct": round(closed / total * 100) if total else 0,
                "issues": issues,
            }
    return tracks

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
    tracks = _enrich_phases(tracks)
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
