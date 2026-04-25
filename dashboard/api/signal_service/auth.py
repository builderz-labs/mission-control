"""JWT authentication and pairing token management."""

import os
import hmac
import hashlib
import secrets
import json
import time
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("signal_auth")

# JWT secret from environment — MUST be set before running
JWT_SECRET = os.environ.get("SIGNAL_JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 365


def _b64url_encode(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    import base64
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def create_jwt(user_id: str, display_name: str) -> str:
    """Create a signed JWT for an agent."""
    if not JWT_SECRET:
        raise ValueError("SIGNAL_JWT_SECRET not set")

    now = int(time.time())
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    payload = {
        "sub": user_id,
        "name": display_name,
        "iss": "ict-signal-server",
        "iat": now,
        "exp": now + (JWT_EXPIRY_DAYS * 86400),
    }

    h = _b64url_encode(json.dumps(header).encode())
    p = _b64url_encode(json.dumps(payload).encode())
    sig = hmac.new(JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    s = _b64url_encode(sig)

    return f"{h}.{p}.{s}"


def validate_jwt(token: str) -> dict | None:
    """Validate a JWT. Returns payload dict or None if invalid."""
    if not JWT_SECRET:
        logger.error("SIGNAL_JWT_SECRET not set")
        return None

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        h, p, s = parts

        # Verify signature
        expected_sig = hmac.new(JWT_SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
        actual_sig = _b64url_decode(s)
        if not hmac.compare_digest(expected_sig, actual_sig):
            logger.warning("JWT signature mismatch")
            return None

        # Decode payload
        payload = json.loads(_b64url_decode(p))

        # Check expiry
        if payload.get("exp", 0) < time.time():
            logger.warning(f"JWT expired for {payload.get('sub')}")
            return None

        return payload

    except Exception as e:
        logger.warning(f"JWT validation error: {e}")
        return None


def generate_pairing_token() -> str:
    """Generate a secure one-time pairing token."""
    return secrets.token_urlsafe(32)


def hash_jwt(token: str) -> str:
    """SHA-256 hash of a JWT for storage (revocation tracking)."""
    return hashlib.sha256(token.encode()).hexdigest()
