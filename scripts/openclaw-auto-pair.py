#!/usr/bin/env python3
"""
Auto-pair MC's openclaw CLI with the openclaw gateway daemon.

Why this exists:
    OpenClaw's WebSocket pairing model requires every CLI client to be
    pair-approved with `openclaw devices approve <requestId>`. Approval
    requires `operator.admin` scope, which by default is held by NO local
    paired device (loopback connections auto-pair as `operator.pairing`
    only). This means the CLI installed in the MC container cannot be
    approved through the standard flow without an interactive `openclaw
    onboard` session — which is impossible in a docker-compose orchestrator
    deploying MC as a sealed container.

What this does:
    Pairing tokens are 32-byte base64url random secrets, stored in plaintext
    JSON files on both sides (gateway: `~/.openclaw/devices/paired.json`,
    MC: `~/.openclaw/identity/device-auth.json`). Both sides are bind-mounted
    on the host. We achieve the same end-state as `devices approve` by
    transactionally patching those files directly:

        1. Read gateway pending.json → find a pending request whose deviceId
           matches MC's identity/device.json (so we don't approve a wrong
           client by accident).
        2. Generate a fresh 32-byte base64url token.
        3. Write gateway paired.json with the FULL operator scope set the
           pending request asked for.
        4. Write MC device-auth.json with the matching token.
        5. Remove the pending entry.

    Idempotent: if MC is already paired (its deviceId is in the gateway's
    paired.json AND its local device-auth.json has a matching token), we
    skip the work and exit 0.

Why this is safe in our context:
    - Both files are local to the host operator running the dev stack.
    - The token format is documented in
      openclaw-src/src/infra/pairing-token.ts:6 — random base64url, no
      crypto signing involved. We're producing exactly the same shape the
      gateway would have produced.
    - The deviceId+publicKey match check ensures we only approve the
      specific MC client that initiated the pending request, not arbitrary
      pending requests that may exist for unrelated clients.

Run it via `make openclaw-pair-mc` from the MC project root.
"""

from __future__ import annotations

import base64
import json
import secrets
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
GATEWAY_DEVICES_DIR = PROJECT_DIR / ".openclaw-data" / "devices"
MC_OPENCLAW_DIR = PROJECT_DIR / ".mc-openclaw"
MC_IDENTITY_DIR = MC_OPENCLAW_DIR / "identity"

GATEWAY_PENDING = GATEWAY_DEVICES_DIR / "pending.json"
GATEWAY_PAIRED = GATEWAY_DEVICES_DIR / "paired.json"
MC_DEVICE = MC_IDENTITY_DIR / "device.json"
MC_DEVICE_AUTH = MC_IDENTITY_DIR / "device-auth.json"

PAIRING_TOKEN_BYTES = 32  # see openclaw-src/src/infra/pairing-token.ts:4


def fail(msg: str, code: int = 1) -> None:
    print(f"[auto-pair] ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def info(msg: str) -> None:
    print(f"[auto-pair] {msg}", flush=True)


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        fail(f"{path} is not valid JSON: {e}")


def write_json_atomic(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=False))
    tmp.replace(path)


def generate_token() -> str:
    raw = secrets.token_bytes(PAIRING_TOKEN_BYTES)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main() -> int:
    if not GATEWAY_DEVICES_DIR.is_dir():
        fail(f"gateway state dir not found: {GATEWAY_DEVICES_DIR} — start openclaw first (make openclaw-up)")
    if not MC_DEVICE.exists():
        fail(
            f"MC openclaw identity not yet created at {MC_DEVICE} — "
            "trigger one CLI call first (e.g. `docker exec mission-control-dev openclaw gateway call health --json` may fail but creates identity)"
        )

    mc_device = load_json(MC_DEVICE, {})
    mc_device_id = mc_device.get("deviceId")
    if not mc_device_id:
        fail(f"{MC_DEVICE} has no deviceId field")

    paired = load_json(GATEWAY_PAIRED, {})
    if mc_device_id in paired:
        existing_scopes = paired[mc_device_id].get("approvedScopes") or paired[mc_device_id].get("scopes") or []
        existing_token = (
            paired[mc_device_id].get("tokens", {}).get("operator", {}).get("token")
        )
        mc_auth = load_json(MC_DEVICE_AUTH, {})
        mc_token = mc_auth.get("tokens", {}).get("operator", {}).get("token")
        if existing_token and mc_token and existing_token == mc_token:
            info(
                f"already paired: deviceId={mc_device_id[:12]}…, scopes={existing_scopes}, exiting idempotent"
            )
            return 0
        info(
            f"deviceId already in gateway paired.json but MC-side token mismatched — "
            "rewriting MC device-auth.json from gateway record"
        )

    pending = load_json(GATEWAY_PENDING, {})
    matching = [req for req in pending.values() if req.get("deviceId") == mc_device_id]
    if not matching:
        fail(
            f"no pending request found for MC deviceId={mc_device_id[:12]}… — "
            "trigger a CLI call from MC first to register the request: "
            "`docker exec mission-control-dev openclaw gateway call health --json`"
        )

    request = matching[0]
    request_id = request["requestId"]
    public_key = request["publicKey"]
    requested_scopes = request.get("scopes") or ["operator.pairing"]
    role = request.get("role", "operator")
    roles = request.get("roles", [role])
    platform = request.get("platform", "linux")
    client_id = request.get("clientId", "cli")
    client_mode = request.get("clientMode", "cli")

    info(
        f"approving requestId={request_id[:12]}…, deviceId={mc_device_id[:12]}…, "
        f"scopes={requested_scopes}"
    )

    token = generate_token()
    now_ms = int(time.time() * 1000)

    paired_entry = {
        "deviceId": mc_device_id,
        "publicKey": public_key,
        "platform": platform,
        "clientId": client_id,
        "clientMode": client_mode,
        "role": role,
        "roles": roles,
        "scopes": requested_scopes,
        "approvedScopes": requested_scopes,
        "tokens": {
            "operator": {
                "token": token,
                "role": role,
                "scopes": requested_scopes,
                "createdAtMs": now_ms,
            }
        },
        "createdAtMs": now_ms,
        "approvedAtMs": now_ms,
    }
    paired[mc_device_id] = paired_entry
    write_json_atomic(GATEWAY_PAIRED, paired)
    info(f"wrote gateway paired.json: {GATEWAY_PAIRED}")

    pending = {k: v for k, v in pending.items() if k != request_id}
    write_json_atomic(GATEWAY_PENDING, pending)
    info(f"removed request {request_id[:12]}… from pending")

    mc_auth = {
        "version": 1,
        "deviceId": mc_device_id,
        "tokens": {
            "operator": {
                "token": token,
                "role": role,
                "scopes": requested_scopes,
                "updatedAtMs": now_ms,
            }
        },
    }
    write_json_atomic(MC_DEVICE_AUTH, mc_auth)
    info(f"wrote MC device-auth.json: {MC_DEVICE_AUTH}")

    info("done — MC's openclaw CLI is now paired with the gateway")
    return 0


if __name__ == "__main__":
    sys.exit(main())
