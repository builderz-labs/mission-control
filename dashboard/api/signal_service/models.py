"""Pydantic models for the signal broadcast system."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class Signal(BaseModel):
    """A trading signal broadcast to connected agents."""
    signal_id: str
    symbol: str                          # ES=F, NQ=F
    timeframe: str                       # 15m, 1h, 1d
    direction: str                       # LONG, SHORT
    entry_price: float
    entry_low: Optional[float] = None    # FVG bottom
    entry_high: Optional[float] = None   # FVG top
    stop_price: float
    target_price: float
    t1: Optional[float] = None
    t2: Optional[float] = None
    t3: Optional[float] = None
    rr: Optional[float] = None
    confidence: int                      # 0-100
    passed: int                          # conditions passed (4 or 5)
    atr: Optional[float] = None
    timestamp: str                       # ISO UTC


class SignalBroadcast(Signal):
    """Signal wrapped for WebSocket delivery."""
    type: str = "signal"


class TradeResult(BaseModel):
    """Trade outcome reported by an agent."""
    type: str = "trade_result"
    signal_id: str
    symbol: str
    direction: str
    entry_price: float
    exit_price: float
    pnl_pts: float
    pnl_dollars: float
    status: str                          # WIN, LOSS
    exit_reason: str                     # TARGET, STOP, MANUAL
    qty: int = 1
    broker_order_id: Optional[str] = None
    timestamp: str


class PairRequest(BaseModel):
    """Pairing token exchange request."""
    pairing_token: str
    agent_version: str = "1.0.0"
    hostname: Optional[str] = None


class PairResponse(BaseModel):
    """JWT returned after successful pairing."""
    jwt: str
    user_id: str
    display_name: str
    expires_in: int                      # seconds


class AgentStatus(BaseModel):
    """Agent connection status."""
    user_id: str
    display_name: str
    connected: bool
    last_seen: Optional[str] = None
    agent_version: Optional[str] = None
    hostname: Optional[str] = None
    trades_today: int = 0


class Entitlement(BaseModel):
    """Server-enforced per-user trading caps pushed to agent on connect."""
    tier: str = "beta"
    max_contracts: int = 1
    max_per_day: int = 5
    allowed_symbols: list[str] = ["ES=F", "NQ=F"]
    allowed_timeframes: list[str] = ["15m", "1h"]
    live_enabled: bool = False
    expires_at: Optional[str] = None


class ServerMessage(BaseModel):
    """Generic server-push message to connected agents."""
    type: str   # entitlement | global_halt | user_halt | force_disconnect
    message: Optional[str] = None
    payload: Optional[dict] = None
