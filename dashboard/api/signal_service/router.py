"""FastAPI router for signal broadcast, pairing, and agent WebSocket."""

import hmac
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException

# Pre-shared secret for scanner → API signal broadcast.  If set, every
# POST /api/signal/broadcast must include X-Scanner-Secret: <value>.
# Provides defense-in-depth alongside the localhost IP check.
_BROADCAST_SECRET = os.getenv("SCANNER_BROADCAST_SECRET", "")

from .models import Signal, PairRequest, PairResponse, AgentStatus
from .auth import create_jwt, validate_jwt, hash_jwt
from .db import (
    init_signal_tables, consume_pairing_token, register_agent,
    update_agent_last_seen, is_agent_active, list_agents,
    get_entitlement, seed_entitlement, log_audit, bump_metric, get_conn,
)
from .connection_manager import manager

logger = logging.getLogger("signal_router")

router = APIRouter()


# ── Pairing ───────────────────────────────────────────────────────────────────

@router.post("/api/pair")
async def pair_agent(req: PairRequest):
    """Exchange a one-time pairing token for a JWT."""
    user_info = consume_pairing_token(req.pairing_token)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid or expired pairing token")

    jwt = create_jwt(user_info["user_id"], user_info["display_name"])

    register_agent(
        user_id=user_info["user_id"],
        display_name=user_info["display_name"],
        jwt_hash=hash_jwt(jwt),
        hostname=req.hostname,
        agent_version=req.agent_version,
    )
    seed_entitlement(user_info["user_id"])
    log_audit(user_info["user_id"], "paired",
              f"hostname={req.hostname} version={req.agent_version}")

    logger.info(f"Agent paired: {user_info['user_id']} ({req.hostname})")

    return PairResponse(
        jwt=jwt,
        user_id=user_info["user_id"],
        display_name=user_info["display_name"],
        expires_in=365 * 86400,
    )


# ── Signal broadcast (internal only) ─────────────────────────────────────────

@router.post("/api/signal/broadcast")
async def broadcast_signal(signal: Signal, request: Request):
    """Receive a signal from the scanner and broadcast to connected agents.

    Two-layer check:
    1. Localhost only — rejects external IPs.
    2. X-Scanner-Secret header — constant-time comparison against
       SCANNER_BROADCAST_SECRET env var (when set).
    """
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Localhost only")

    if _BROADCAST_SECRET:
        provided = request.headers.get("X-Scanner-Secret", "")
        if not hmac.compare_digest(provided.encode(), _BROADCAST_SECRET.encode()):
            logger.warning("Broadcast rejected: invalid X-Scanner-Secret from %s", client_host)
            raise HTTPException(status_code=403, detail="Invalid scanner secret")
    else:
        logger.debug("SCANNER_BROADCAST_SECRET not set — skipping secret check")

    message = signal.model_dump()
    message["type"] = "signal"

    delivered = await manager.broadcast(message)

    return {
        "status": "broadcast",
        "agents_connected": manager.connected_count,
        "agents_delivered": delivered,
        "signal_id": signal.signal_id,
    }


# ── Agent WebSocket ───────────────────────────────────────────────────────────

@router.websocket("/ws/signals")
async def websocket_signals(websocket: WebSocket):
    """Authenticated WebSocket for signal delivery and result reporting."""

    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    payload = validate_jwt(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    user_id = payload["sub"]

    if not is_agent_active(user_id):
        await websocket.close(code=4003, reason="Agent revoked")
        return

    seed_entitlement(user_id)
    entitlement = get_entitlement(user_id)

    await websocket.accept()
    manager.connect(user_id, websocket, entitlement)
    update_agent_last_seen(user_id)
    bump_metric(user_id, "connects")
    log_audit(user_id, "connect",
              f"version={websocket.query_params.get('agent_version', 'unknown')}")

    logger.info(
        f"Agent connected: {user_id} "
        f"(tier={entitlement['tier']}, live={entitlement['live_enabled']})"
    )

    # Push entitlement immediately so agent applies correct limits before first signal
    await websocket.send_json({"type": "entitlement", **entitlement})

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "pong":
                update_agent_last_seen(user_id)

            elif msg_type == "trade_result":
                await _handle_trade_result(user_id, data, entitlement)

            elif msg_type == "status":
                update_agent_last_seen(user_id)
                logger.debug(f"Agent {user_id} status: {data.get('state')}")

    except WebSocketDisconnect:
        logger.info(f"Agent disconnected: {user_id}")
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
    finally:
        bump_metric(user_id, "disconnects")
        log_audit(user_id, "disconnect")
        manager.disconnect(user_id)


async def _handle_trade_result(user_id: str, data: dict, entitlement: dict):
    """Log a trade result reported by an agent, with entitlement validation."""
    reported_qty  = data.get("qty", 1)
    max_contracts = entitlement.get("max_contracts", 1)
    is_live       = data.get("mode") == "live"

    # Reject live execution reports if user is not entitled to live trading
    if is_live and not entitlement.get("live_enabled"):
        logger.warning(f"Live execution report rejected for {user_id}: live_enabled=False")
        log_audit(user_id, "entitlement_violation",
                  f"live_not_enabled signal={data.get('signal_id')}")
        return

    # Reject expired subscriptions
    if entitlement.get("expired"):
        logger.warning(f"Trade result rejected for {user_id}: subscription expired")
        log_audit(user_id, "entitlement_violation",
                  f"subscription_expired signal={data.get('signal_id')}")
        return

    if reported_qty > max_contracts:
        logger.warning(
            f"Entitlement violation from {user_id}: qty={reported_qty} > max={max_contracts}"
        )
        log_audit(user_id, "entitlement_violation",
                  f"qty={reported_qty} max={max_contracts} signal={data.get('signal_id')}")
        return

    try:
        pt_val  = {"ES=F": 5.0, "NQ=F": 2.0}
        symbol  = data.get("symbol", "")
        pnl_pts = data.get("pnl_pts", 0)
        pnl_usd = round(pnl_pts * pt_val.get(symbol, 5.0), 2)

        conn = get_conn()
        conn.execute("""
            INSERT INTO paper_trades
            (ts_entry, symbol, timeframe, direction, entry_price, stop_price, target_price,
             status, ts_exit, exit_price, pnl_pts, pnl_futures, confidence,
             account_id, mode, broker_order_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)
        """, (
            data.get("timestamp"), symbol, data.get("timeframe", ""),
            data.get("direction"), data.get("entry_price"), 0, 0,
            data.get("status"), data.get("timestamp"), data.get("exit_price"),
            pnl_pts, pnl_usd, 0,
            user_id, data.get("broker_order_id"),
            f"Agent report | {data.get('exit_reason', '')}",
        ))
        conn.commit()
        conn.close()

        bump_metric(user_id, "trades_attempted")
        log_audit(user_id, "trade_result",
                  f"signal={data.get('signal_id')} {symbol} {data.get('status')} {pnl_pts:+.2f}pts")
        logger.info(
            f"Trade result from {user_id}: {symbol} {data.get('status')} "
            f"{pnl_pts:+.2f}pts (${pnl_usd:+.2f})"
        )

    except Exception as e:
        logger.error(f"Failed to log trade result from {user_id}: {e}")


# ── Admin — agent management ──────────────────────────────────────────────────

@router.get("/api/agents")
async def get_agents(request: Request):
    """List all registered agents with live connection status (admin only)."""
    from auth import require_admin
    require_admin(request)
    agents    = list_agents()
    connected = set(manager.connected_users)

    result = [
        AgentStatus(
            user_id=a["user_id"],
            display_name=a["display_name"],
            connected=a["user_id"] in connected,
            last_seen=a.get("last_seen"),
            agent_version=a.get("agent_version"),
            hostname=a.get("hostname"),
        )
        for a in agents
    ]
    return {"agents": [a.model_dump() for a in result]}


@router.post("/api/agents/{user_id}/halt")
async def halt_user_agent(user_id: str, request: Request):
    """Push a user_halt message to a specific connected agent (admin only)."""
    from auth import require_admin
    require_admin(request)
    sent = await manager.send_to(user_id, {"type": "user_halt", "message": "Halted by admin"})
    log_audit(user_id, "user_halt", "pushed by admin")
    return {"sent": sent, "user_id": user_id}


@router.post("/api/agents/halt_all")
async def halt_all_agents(request: Request):
    """Push a global_halt message to every connected agent (admin only)."""
    from auth import require_admin
    require_admin(request)
    delivered = await manager.broadcast({"type": "global_halt", "message": "Global halt by admin"})
    log_audit("system", "global_halt", f"delivered to {delivered} agents")
    return {"delivered": delivered}
