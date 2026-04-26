"""Agent update-check endpoint.

GET /agent/latest — returns current agent version + download URL.
The agent calls this on startup to check if an update is available.
"""

import logging
import os

import httpx
from fastapi import APIRouter

logger = logging.getLogger("killzone.agent_release")

router = APIRouter()

GITHUB_REPO  = os.getenv("GITHUB_REPO", "spaceghostroce/roce-os")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")  # optional, raises rate limit from 60 to 5000/hr


@router.get("/agent/latest")
async def agent_latest():
    """Return the latest agent release version and download URLs.

    Proxies GitHub releases API so the agent doesn't need a GitHub token.
    Falls back to a static response if GitHub is unreachable.
    """
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases",
                headers=headers,
            )
            releases = resp.json()

        # Find latest release with an agent tag (agent-v*)
        agent_releases = [
            r for r in releases
            if isinstance(r, dict) and r.get("tag_name", "").startswith("agent-v")
        ]
        if not agent_releases:
            return {"version": None, "message": "No agent releases published yet"}

        latest = agent_releases[0]
        tag     = latest["tag_name"]                      # e.g. agent-v1.1.0
        version = tag.removeprefix("agent-v")             # e.g. 1.1.0

        assets = {a["name"]: a["browser_download_url"] for a in latest.get("assets", [])}

        return {
            "version":       version,
            "tag":           tag,
            "prerelease":    latest.get("prerelease", False),
            "published_at":  latest.get("published_at"),
            "release_url":   latest.get("html_url"),
            "exe_url":       assets.get("ICT-Agent.exe"),
            "setup_url":     next((v for k, v in assets.items() if k.startswith("ict-agent-setup")), None),
            "changelog":     latest.get("body", "")[:500],
        }

    except Exception as e:
        logger.warning(f"GitHub releases fetch failed: {e}")
        return {"version": None, "error": "Could not fetch release info", "detail": str(e)}
