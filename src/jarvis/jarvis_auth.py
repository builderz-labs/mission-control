"""Auth module for JARVIS — bearer token validation and CORS origin helpers."""
from __future__ import annotations

import fnmatch
import logging
import os
import secrets
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger("jarvis")


def _ensure_auth_token() -> str:
    """Return JARVIS_AUTH_TOKEN from env. Auto-generate and persist if missing."""
    token = os.getenv("JARVIS_AUTH_TOKEN", "").strip()
    if token:
        return token
    token = secrets.token_hex(32)
    _env_path_auth = Path(__file__).parent / ".env"
    # Append to .env (create if needed)
    with _env_path_auth.open("a") as fh:
        fh.write(f"\nJARVIS_AUTH_TOKEN={token}\n")
    os.environ["JARVIS_AUTH_TOKEN"] = token
    log.info("Generated new JARVIS_AUTH_TOKEN and wrote it to .env")
    return token


JARVIS_AUTH_TOKEN: str = _ensure_auth_token()

_bearer_scheme = HTTPBearer()


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> str:
    """FastAPI dependency — validates Authorization: Bearer <token>."""
    if not secrets.compare_digest(credentials.credentials, JARVIS_AUTH_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid or missing auth token")
    return credentials.credentials


def _verify_ws_token(token: str | None) -> bool:
    """Check WebSocket query-param token using constant-time comparison."""
    if not token:
        return False
    return secrets.compare_digest(token, JARVIS_AUTH_TOKEN)


def _parse_allowed_origins() -> list[str]:
    """Build allowed-origins list from env or sensible defaults."""
    raw = os.getenv("JARVIS_ALLOWED_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    # Default: localhost on common dev ports (3000-3003 cover all typical Next.js setups)
    mc_port = os.getenv("MC_PORT", "3000")
    base_ports = {"3000", "3001", "3002", "3003", mc_port}
    origins = []
    for p in sorted(base_ports):
        origins += [f"http://localhost:{p}", f"http://127.0.0.1:{p}"]
    return origins


def _origin_matches(origin: str, patterns: list[str]) -> bool:
    """Check if an origin matches any pattern (supports fnmatch wildcards)."""
    return any(fnmatch.fnmatch(origin, p) for p in patterns)
