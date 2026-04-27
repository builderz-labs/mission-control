"""Killzone Dashboard — FastAPI Backend

Serves trading data from SQLite + Alpaca API to the Next.js frontend.
Endpoints:
  /api/version      — App version (from /VERSION) + git SHA
  /api/overview     — KPI cards (win rate, total trades, daily P&L, open positions)
  /api/trades       — Paper trade history with filters
  /api/signals      — Recent signal log
  /api/positions    — Current open positions
  /api/equity       — Equity curve data points
  /api/scanner      — Current scanner state (conditions, confluence, bias)
  /api/scheduler    — RoceOS scheduler jobs and history
  /api/health       — System health checks
  /ws/prices        — WebSocket for live price updates
"""
import asyncio
import json
import logging
import os
import sqlite3
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# Repo-root version — works whether deployed at /opt/ict-dashboard-backend (legacy)
# or run from the monorepo at /docker/roce-os/dashboard/api.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if not (_REPO_ROOT / "engine" / "version.py").exists():
    _REPO_ROOT = Path(os.getenv("ROCEOS_REPO", "/docker/roce-os"))
sys.path.insert(0, str(_REPO_ROOT))
from engine.version import __version__, git_sha

# Signal broadcast service
from signal_service.router import router as signal_router
from signal_service.db import init_signal_tables
from signal_service.connection_manager import manager as signal_manager

# Proposal tracker
from proposals import router as proposals_router

# Roadmap (reads docs/roadmap.yaml)
from roadmap import router as roadmap_router

# Detailed health (reads /var/lib/system-health/status.json from system_health.sh)
from health import router as health_router

# Session auth (P1)
from auth import router as auth_router, settings_router, seed_admin

# User management
from users import router as users_router

# Agent update-check
from agent_release import router as agent_release_router

# Discord OAuth
from discord_auth import router as discord_auth_router, migrate_discord_columns

# Entitlements admin
from entitlements import router as entitlements_router


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ict-dashboard")

TRADING_DB = os.getenv("TRADING_DB_PATH", "/opt/trading-workspace/trading/data/trading.db")

# Allow credentials requires explicit origins (cannot use * with cookies).
# Set CORS_ALLOW_ORIGINS env var to a comma-separated list for prod.
_cors_env = os.getenv("CORS_ALLOW_ORIGINS", "")
CORS_ORIGINS = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else [
        "https://dashboard.ictwealthbuilding.com",
        "http://localhost:3000",
        "http://localhost:3001",
    ]
)

# ── Database helpers ──────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(TRADING_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    try:
        conn = get_db()
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"DB query failed: {e}")
        return []


# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Dashboard backend starting...")
    init_signal_tables()
    asyncio.create_task(signal_manager.heartbeat_loop())
    logger.info("Signal broadcast service initialized")
    seed_admin()
    migrate_discord_columns()
    logger.info("Auth tables ready")
    yield
    logger.info("Dashboard backend shutting down")


app = FastAPI(title="Killzone Dashboard API", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "0"
    return response


# Mount signal broadcast service
app.include_router(signal_router)

# Mount proposal tracker
app.include_router(proposals_router)

# Mount roadmap
app.include_router(roadmap_router)

# Mount detailed health (separate from the existing /api/health summary)
app.include_router(health_router)

# Mount session auth + user settings
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(users_router)
app.include_router(agent_release_router)
app.include_router(discord_auth_router)
app.include_router(entitlements_router)


# ── Execution kill switch ─────────────────────────────────────────────────────

_HALT_FLAG = Path("/tmp/execution_halt")


@app.post("/api/execution/halt")
async def execution_halt(request: Request):
    from auth import require_admin
    require_admin(request)
    _HALT_FLAG.touch()
    logger.warning("Execution HALTED via dashboard API")
    return {"halted": True, "ts": datetime.now(timezone.utc).isoformat()}


@app.post("/api/execution/resume")
async def execution_resume(request: Request):
    from auth import require_admin
    require_admin(request)
    if _HALT_FLAG.exists():
        _HALT_FLAG.unlink()
    logger.info("Execution RESUMED via dashboard API")
    return {"halted": False, "ts": datetime.now(timezone.utc).isoformat()}


@app.get("/api/execution/status")
async def execution_status():
    return {"halted": _HALT_FLAG.exists(), "ts": datetime.now(timezone.utc).isoformat()}


# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/api/version")
async def version():
    """App version + git SHA. Single source of truth: /VERSION at repo root."""
    return {
        "app": "Killzone",
        "version": __version__,
        "commit": git_sha(),
    }


@app.get("/api/overview")
async def overview():
    """KPI cards — win rate, total trades, daily P&L, open positions."""
    stats = query("""
        SELECT
            COUNT(*) as total_trades,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses,
            SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) as open_count,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_rate
        FROM paper_trades
    """)

    by_symbol = query("""
        SELECT symbol,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_rate
        FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY symbol
    """)

    by_timeframe = query("""
        SELECT timeframe,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_rate
        FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY timeframe
    """)

    by_direction = query("""
        SELECT direction,
            SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) as losses,
            ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_rate
        FROM paper_trades WHERE status IN ('WIN','LOSS') GROUP BY direction
    """)

    # Today's trades
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_trades = query(
        "SELECT COUNT(*) as count FROM paper_trades WHERE ts_entry LIKE ?",
        (f"{today}%",)
    )

    return {
        "summary": stats[0] if stats else {},
        "by_symbol": by_symbol,
        "by_timeframe": by_timeframe,
        "by_direction": by_direction,
        "today_trades": today_trades[0]["count"] if today_trades else 0,
    }


@app.get("/api/trades")
async def trades(
    status: str = Query(None, description="Filter by status: WIN, LOSS, OPEN, EXPIRED"),
    symbol: str = Query(None),
    timeframe: str = Query(None),
    direction: str = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    """Paper trade history with filters."""
    where = []
    params = []

    if status:
        where.append("status = ?")
        params.append(status)
    if symbol:
        where.append("symbol = ?")
        params.append(symbol)
    if timeframe:
        where.append("timeframe = ?")
        params.append(timeframe)
    if direction:
        where.append("direction = ?")
        params.append(direction)

    where_clause = " AND ".join(where) if where else "1=1"
    params.extend([limit, offset])

    rows = query(
        f"SELECT * FROM paper_trades WHERE {where_clause} ORDER BY ts_entry DESC LIMIT ? OFFSET ?",
        tuple(params),
    )

    total = query(f"SELECT COUNT(*) as count FROM paper_trades WHERE {where_clause}", tuple(params[:-2]))

    return {
        "trades": rows,
        "total": total[0]["count"] if total else 0,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/positions")
async def positions():
    """Current open paper trades with T1/T2/T3 targets."""
    pos = query(
        "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY ts_entry DESC"
    )
    for p in pos:
        entry = p.get("entry_price", 0)
        stop = p.get("stop_price", 0)
        t1 = p.get("target_price", 0)
        if entry and t1:
            # T1 is the -0.5 fib extension. T2 = -1.0 (2x), T3 = -2.0 (4x)
            leg = abs(t1 - entry)  # Distance from entry to T1 = the -0.5 leg
            if p.get("direction") == "LONG":
                p["t1"] = t1
                p["t2"] = round(entry + leg * 2, 2)  # -1.0 extension
                p["t3"] = round(entry + leg * 4, 2)  # -2.0 extension
            else:
                p["t1"] = t1
                p["t2"] = round(entry - leg * 2, 2)
                p["t3"] = round(entry - leg * 4, 2)
    return {"positions": pos}


@app.get("/api/signals")
async def signals(limit: int = Query(50, le=200)):
    """Recent signal log."""
    return {
        "signals": query(
            "SELECT * FROM signals ORDER BY ts DESC LIMIT ?", (limit,)
        )
    }


# Dollar value per point for each micro contract
_POINT_VALUES = {"ES=F": 5.0, "NQ=F": 2.0}


@app.get("/api/equity")
async def equity():
    """Equity curve split by symbol and in dollars.

    Returns three curves:
      curve       — all trades, cumulative in dollars (ES $5/pt, NQ $2/pt)
      curve_es    — ES=F trades only, cumulative in ES points
      curve_nq    — NQ=F trades only, cumulative in NQ points
    """
    closed = query("""
        SELECT ts_exit, symbol, direction, entry_price, exit_price, status
        FROM paper_trades
        WHERE status IN ('WIN', 'LOSS') AND exit_price IS NOT NULL
        ORDER BY ts_exit ASC
    """)

    curve, curve_es, curve_nq = [], [], []
    cum_dollars = cum_es = cum_nq = 0.0

    for t in closed:
        pts = (t["exit_price"] - t["entry_price"]) if t["direction"] == "LONG" \
              else (t["entry_price"] - t["exit_price"])
        dollars = pts * _POINT_VALUES.get(t["symbol"], 5.0)
        cum_dollars += dollars

        base = {
            "date": t["ts_exit"],
            "pnl_pts": round(pts, 2),
            "pnl_dollars": round(dollars, 2),
            "symbol": t["symbol"],
            "status": t["status"],
        }
        curve.append({**base, "cumulative": round(cum_dollars, 2)})

        if t["symbol"] == "ES=F":
            cum_es += pts
            curve_es.append({**base, "cumulative": round(cum_es, 2)})
        elif t["symbol"] == "NQ=F":
            cum_nq += pts
            curve_nq.append({**base, "cumulative": round(cum_nq, 2)})

    return {
        "curve": curve,
        "curve_es": curve_es,
        "curve_nq": curve_nq,
        "total_pnl": round(cum_dollars, 2),
        "total_pnl_es_pts": round(cum_es, 2),
        "total_pnl_nq_pts": round(cum_nq, 2),
    }


@app.get("/api/scanner")
async def scanner_state():
    """Latest scanner results per instrument/timeframe."""
    latest = query("""
        SELECT * FROM signals
        WHERE ts = (SELECT MAX(ts) FROM signals WHERE symbol=signals.symbol AND timeframe=signals.timeframe)
        ORDER BY symbol, timeframe
    """)
    return {"scanner": latest}


@app.get("/api/scheduler")
async def scheduler():
    """RoceOS scheduler status — proxy to engine API."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://localhost:8000/scheduler/status")
            return resp.json()
    except Exception as e:
        return {"error": str(e), "status": "unreachable"}


@app.get("/api/health")
async def health():
    """System health checks."""
    import httpx
    checks = {}

    # Database
    try:
        conn = get_db()
        conn.execute("SELECT 1")
        conn.close()
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    # Endpoints — pulse removed 2026-04-25 (CNAME deleted, deprecated app)
    async with httpx.AsyncClient(timeout=5) as client:
        for name, url in [
            ("webhook", "https://webhook.ictwealthbuilding.com/health"),
        ]:
            try:
                resp = await client.get(url)
                checks[name] = f"ok ({resp.status_code})"
            except Exception as e:
                checks[name] = f"error: {str(e)[:50]}"

        # RoceOS engine
        try:
            resp = await client.get("http://localhost:8000/health")
            data = resp.json()
            checks["roceos"] = f"ok ({data.get('skillsets', []).__len__()} skillsets)"
        except Exception:
            checks["roceos"] = "unreachable"

    return {
        "status": "ok" if all("ok" in str(v) for v in checks.values()) else "degraded",
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── WebSocket for live price updates ─────────────────────────────────────────

_ws_clients: set[WebSocket] = set()


@app.websocket("/ws/prices")
async def websocket_prices(websocket: WebSocket):
    from auth import get_current_user
    # WebSocket handshake carries cookies — validate session before accepting.
    session_id = websocket.cookies.get("kz_session")
    user = get_current_user(websocket) if session_id else None
    if not user:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping", "ts": datetime.now(timezone.utc).isoformat()})
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
