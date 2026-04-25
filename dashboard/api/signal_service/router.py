"""FastAPI router for signal broadcast, pairing, and agent WebSocket."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse

from .models import Signal, TradeResult, PairRequest, PairResponse, AgentStatus
from .auth import create_jwt, validate_jwt, hash_jwt
from .db import (
    init_signal_tables, consume_pairing_token, register_agent,
    update_agent_last_seen, is_agent_active, list_agents, get_conn,
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

    logger.info(f"Agent paired: {user_info['user_id']} ({req.hostname})")

    return PairResponse(
        jwt=jwt,
        user_id=user_info["user_id"],
        display_name=user_info["display_name"],
        expires_in=365 * 86400,
    )


# ── Signal Broadcast (internal) ──────────────────────────────────────────────

@router.post("/api/signal/broadcast")
async def broadcast_signal(signal: Signal, request: Request):
    """Receive a signal from the scanner and broadcast to all connected agents.
    Localhost only — rejects external requests."""

    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Localhost only")

    message = signal.model_dump()
    message["type"] = "signal"

    delivered = await manager.broadcast(message)

    return {"status": "broadcast", "agents_connected": manager.connected_count,
            "agents_delivered": delivered, "signal_id": signal.signal_id}


# ── Agent WebSocket ───────────────────────────────────────────────────────────

@router.websocket("/ws/signals")
async def websocket_signals(websocket: WebSocket):
    """Authenticated WebSocket for signal delivery and result reporting."""

    # Auth: JWT from query parameter
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    payload = validate_jwt(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    user_id = payload["sub"]

    # Check agent is active (not revoked)
    if not is_agent_active(user_id):
        await websocket.close(code=4003, reason="Agent revoked")
        return

    await websocket.accept()
    manager.connect(user_id, websocket)
    update_agent_last_seen(user_id)

    logger.info(f"WebSocket connected: {user_id}")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "pong":
                update_agent_last_seen(user_id)

            elif msg_type == "trade_result":
                await _handle_trade_result(user_id, data)

            elif msg_type == "status":
                update_agent_last_seen(user_id)
                logger.debug(f"Agent {user_id} status: {data.get('state')}")

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {user_id}")
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
    finally:
        manager.disconnect(user_id)


async def _handle_trade_result(user_id: str, data: dict):
    """Process a trade result reported by an agent."""
    try:
        # Log to the paper_trades table as a live trade for this user
        conn = get_conn()

        # Point values for dollar P&L
        pt_val = {"ES=F": 5.0, "NQ=F": 2.0}  # micro contracts
        symbol = data.get("symbol", "")
        pnl_pts = data.get("pnl_pts", 0)
        pnl_futures = round(pnl_pts * pt_val.get(symbol, 5.0), 2)

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
            pnl_pts, pnl_futures, 0,
            user_id, data.get("broker_order_id"),
            f"Agent report | {data.get('exit_reason', '')}",
        ))
        conn.commit()
        conn.close()

        logger.info(f"Trade result from {user_id}: {symbol} {data.get('status')} "
                    f"{pnl_pts:+.2f} pts (${pnl_futures:+.2f})")

    except Exception as e:
        logger.error(f"Failed to log trade result from {user_id}: {e}")


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/api/agents")
async def get_agents():
    """List all registered agents with connection status."""
    agents = list_agents()
    connected = set(manager.connected_users)

    result = []
    for a in agents:
        result.append(AgentStatus(
            user_id=a["user_id"],
            display_name=a["display_name"],
            connected=a["user_id"] in connected,
            last_seen=a.get("last_seen"),
            agent_version=a.get("agent_version"),
            hostname=a.get("hostname"),
        ))

    return {"agents": [a.model_dump() for a in result]}
