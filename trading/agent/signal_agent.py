#!/usr/bin/env python3
"""
ICT Signal Agent — Automated Futures Execution

Connects to the ICT Signal Server, receives trading signals,
and executes bracket orders on your Tradovate account.

Your broker credentials never leave this machine.

First run:  python signal_agent.py --setup
Normal run: python signal_agent.py
Pause:      touch ~/.ict-agent/PAUSED   (stops new executions without killing process)
Resume:     rm ~/.ict-agent/PAUSED
"""

import argparse
import asyncio
import getpass
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Missing dependency: pip install httpx")
    sys.exit(1)

try:
    import websockets
    import websockets.exceptions
except ImportError:
    print("Missing dependency: pip install websockets")
    sys.exit(1)

try:
    import keyring
    import keyring.errors
except ImportError:
    print("ERROR: 'keyring' package is required for secure credential storage.")
    print("Install it with: pip install keyring")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────────

CONFIG_DIR    = Path.home() / ".ict-agent"
CONFIG_FILE   = CONFIG_DIR / "config.json"
STATE_FILE    = CONFIG_DIR / "state.json"
LOG_FILE      = CONFIG_DIR / "agent.log"
TRADES_FILE   = CONFIG_DIR / "trades.json"
PAUSE_FLAG    = CONFIG_DIR / "PAUSED"
KEYRING_SVC   = "ict-agent"

DEFAULT_SERVER = "wss://api.ictwealthbuilding.com/ws/signals"
AGENT_VERSION  = "1.1.0"

# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logging(level: str = "INFO"):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler(),
        ],
    )

logger = logging.getLogger("ict-agent")

# ── Tradovate client ──────────────────────────────────────────────────────────

TRADOVATE_DEMO_URL = "https://demo.tradovateapi.com/v1"
TRADOVATE_LIVE_URL = "https://live.tradovateapi.com/v1"

SYMBOL_MAP   = {"ES=F": "MES", "NQ=F": "MNQ"}
POINT_VALUES = {"MES": 5.0, "MNQ": 2.0}


class TradovateClient:
    """Minimal Tradovate REST client for bracket order execution."""

    def __init__(self, username: str, password: str, cid: str, sec: str,
                 live: bool = False):
        self.base_url    = TRADOVATE_LIVE_URL if live else TRADOVATE_DEMO_URL
        self.username    = username
        self.password    = password
        self.cid         = cid
        self.sec         = sec
        self.live        = live
        self.access_token = None
        self.token_expiry = 0
        self.account_id   = None

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }

    def authenticate(self) -> bool:
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{self.base_url}/auth/accesstokenrequest", json={
                "name": self.username, "password": self.password,
                "appId": "ICT-Agent", "appVersion": AGENT_VERSION,
                "cid": self.cid, "sec": self.sec,
            })
        data = resp.json()
        if data.get("errorText"):
            logger.error(f"Tradovate auth failed: {data['errorText']}")
            return False
        self.access_token = data["accessToken"]
        self.token_expiry = time.time() + (75 * 60)
        accounts = self._get("/account/list")
        if accounts:
            self.account_id = accounts[0]["id"]
        logger.info(f"Tradovate authenticated ({'LIVE' if self.live else 'DEMO'}), "
                    f"account={self.account_id}")
        return True

    def ensure_auth(self):
        if self.access_token and time.time() < self.token_expiry:
            return
        if self.access_token:
            try:
                data = self._get("/auth/renewaccesstoken")
                if data.get("accessToken"):
                    self.access_token = data["accessToken"]
                    self.token_expiry = time.time() + (75 * 60)
                    return
            except Exception:
                pass
        self.authenticate()

    def _get(self, path: str):
        if self.access_token:
            self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            return client.get(f"{self.base_url}{path}", headers=self._headers()).json()

    def _post(self, path: str, body: dict):
        self.ensure_auth()
        with httpx.Client(timeout=15) as client:
            return client.post(
                f"{self.base_url}{path}", headers=self._headers(), json=body
            ).json()

    def get_positions(self) -> list:
        return self._get("/position/list") or []

    def get_orders(self) -> list:
        return self._get("/order/list") or []

    def place_bracket_order(self, symbol: str, action: str, qty: int,
                            stop_price: float, target_price: float) -> dict:
        exit_action = "Sell" if action == "Buy" else "Buy"
        return self._post("/order/placeoso", {
            "accountSpec": self.username,
            "accountId":   self.account_id,
            "action":      action,
            "symbol":      symbol,
            "orderQty":    qty,
            "orderType":   "Market",
            "timeInForce": "Day",
            "isAutomated": True,
            "bracket1": {
                "action":      exit_action,
                "orderType":   "Stop",
                "stopPrice":   stop_price,
                "qty":         qty,
                "timeInForce": "GTC",
                "isAutomated": True,
            },
            "bracket2": {
                "action":      exit_action,
                "orderType":   "Limit",
                "price":       target_price,
                "qty":         qty,
                "timeInForce": "GTC",
                "isAutomated": True,
            },
        })


def _third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    days_to_first_friday = (4 - d.weekday()) % 7
    return d + timedelta(days=days_to_first_friday + 14)


def get_front_month(scanner_symbol: str) -> str:
    """Convert scanner symbol (ES=F) to Tradovate front-month contract (MESM6)."""
    base = SYMBOL_MAP.get(scanner_symbol)
    if not base:
        raise ValueError(f"Unknown symbol: {scanner_symbol}")

    EXPIRY_MONTHS = [3, 6, 9, 12]
    MONTH_CODE    = {3: "H", 6: "M", 9: "U", 12: "Z"}

    today = datetime.now(timezone.utc).date()
    for m in EXPIRY_MONTHS:
        if m < today.month:
            continue
        roll_date = _third_friday(today.year, m) - timedelta(days=8)
        if today < roll_date:
            return f"{base}{MONTH_CODE[m]}{today.year % 10}"

    return f"{base}H{(today.year + 1) % 10}"


# ── Credential storage (keyring only — no plaintext fallback) ─────────────────

def _store_cred(key: str, value: str) -> None:
    try:
        keyring.set_password(KEYRING_SVC, key, value)
    except keyring.errors.NoKeyringError:
        print("\nERROR: No system keyring found.")
        print("On Linux, install one with: sudo apt install gnome-keyring")
        print("Or set the environment variable: PYTHON_KEYRING_BACKEND=keyring.backends.fail.Keyring")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: Keyring write failed: {e}")
        sys.exit(1)


def _get_cred(key: str) -> str | None:
    try:
        return keyring.get_password(KEYRING_SVC, key)
    except keyring.errors.NoKeyringError:
        logger.error("No system keyring found — cannot read credentials. Re-run --setup.")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Keyring read failed: {e}")
        sys.exit(1)


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    CONFIG_FILE.chmod(0o600)


# ── State (persists open trades + executed signal IDs across restarts) ─────────

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"executed_signals": [], "open_trades": {}}


def save_state(state: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))
    STATE_FILE.chmod(0o600)


# ── Risk manager ──────────────────────────────────────────────────────────────

class RiskManager:
    """Local risk gates. Server entitlement is the hard ceiling; this is the floor."""

    def __init__(self, risk_config: dict, open_trades: dict = None):
        self.max_per_instrument = risk_config.get("max_per_instrument", 2)
        self.daily_loss_halt    = risk_config.get("daily_loss_halt", 3)
        self.enabled_symbols    = risk_config.get("enabled_symbols", ["ES=F", "NQ=F"])
        self.qty                = risk_config.get("qty", 1)

        self._open_trades  = dict(open_trades or {})
        self._daily_losses: dict[str, int] = {}
        self._today: str = ""

    def _reset_daily_if_needed(self):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today != self._today:
            self._daily_losses = {}
            self._today = today

    def check(self, symbol: str, direction: str) -> str | None:
        """Returns None if trade is allowed, or a skip reason string."""
        self._reset_daily_if_needed()

        if symbol not in self.enabled_symbols:
            return f"symbol {symbol} not in enabled list"

        if self._open_trades.get(symbol, 0) >= self.max_per_instrument:
            return f"position cap ({self._open_trades[symbol]}/{self.max_per_instrument} open)"

        if self._daily_losses.get(symbol, 0) >= self.daily_loss_halt:
            return f"daily halt ({self._daily_losses[symbol]} losses today)"

        return None

    def on_open(self, symbol: str):
        self._open_trades[symbol] = self._open_trades.get(symbol, 0) + 1

    def on_close(self, symbol: str, is_loss: bool):
        self._open_trades[symbol] = max(0, self._open_trades.get(symbol, 0) - 1)
        if is_loss:
            self._reset_daily_if_needed()
            self._daily_losses[symbol] = self._daily_losses.get(symbol, 0) + 1


# ── Trade ledger ──────────────────────────────────────────────────────────────

def log_trade(trade: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    trades = []
    if TRADES_FILE.exists():
        try:
            trades = json.loads(TRADES_FILE.read_text())
        except Exception:
            pass
    trades.append(trade)
    TRADES_FILE.write_text(json.dumps(trades[-500:], indent=2))


# ── Setup wizard ──────────────────────────────────────────────────────────────

def setup_wizard() -> None:
    print("\n=== ICT Signal Agent Setup ===\n")

    cfg = load_config()

    # Step 1: pairing token → JWT
    server = input(f"Signal server URL [{DEFAULT_SERVER}]: ").strip() or DEFAULT_SERVER
    token  = input("Pairing token (from Ross): ").strip()
    if not token:
        print("Error: pairing token required.")
        sys.exit(1)

    pair_url = server.replace("wss://", "https://").replace("/ws/signals", "")
    hostname = os.environ.get("COMPUTERNAME") or (
        os.uname().nodename if hasattr(os, "uname") else "unknown"
    )
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{pair_url}/api/pair", json={
                "pairing_token": token,
                "agent_version": AGENT_VERSION,
                "hostname":      hostname,
            })
        if resp.status_code != 200:
            print(f"Pairing failed: {resp.json().get('detail', resp.text)}")
            sys.exit(1)
        pair_data = resp.json()
        print(f"\nPaired as: {pair_data['display_name']} ({pair_data['user_id']})")
    except Exception as e:
        print(f"Pairing error: {e}")
        sys.exit(1)

    cfg["server_url"] = server
    cfg["user_id"]    = pair_data["user_id"]
    # JWT goes into keyring — never stored in the config file
    _store_cred("jwt", pair_data["jwt"])
    print("JWT stored in system keyring.")

    # Step 2: Tradovate credentials
    print("\n--- Tradovate Credentials ---")
    print("Stored in your OS credential manager. Never sent to our servers.\n")
    print("Where to find cid/sec: Tradovate → Settings → API Access → API Add-On\n")

    tv_user = input("Tradovate username (email): ").strip()
    tv_pass = getpass.getpass("Tradovate password: ")
    tv_cid  = input("API Client ID (cid): ").strip()
    tv_sec  = getpass.getpass("API Secret (sec): ")

    if not all([tv_user, tv_pass, tv_cid, tv_sec]):
        print("Error: all Tradovate credentials are required.")
        sys.exit(1)

    _store_cred("tradovate_username", tv_user)
    _store_cred("tradovate_password", tv_pass)
    _store_cred("tradovate_cid",      tv_cid)
    _store_cred("tradovate_sec",      tv_sec)
    print("Tradovate credentials stored in system keyring.")

    # Test against DEMO first — never touches real money during setup
    print("\nTesting Tradovate connection (demo)...")
    try:
        tc = TradovateClient(tv_user, tv_pass, tv_cid, tv_sec, live=False)
        if tc.authenticate():
            print(f"Connected to Tradovate DEMO. Account ID: {tc.account_id}")
        else:
            print("Warning: Tradovate auth failed — check credentials. Re-run --setup to retry.")
    except Exception as e:
        print(f"Warning: Tradovate test error: {e}")

    # Step 3: risk config
    print("\n--- Risk Settings ---")
    print("These are your LOCAL limits. The server also enforces its own ceiling.")
    print("Conservative defaults shown — adjust carefully.\n")

    qty     = input("Contracts per trade [1]: ").strip() or "1"
    max_pos = input("Max open trades per instrument [2]: ").strip() or "2"
    halt    = input("Auto-halt after N losses today [3]: ").strip() or "3"

    cfg["risk"] = {
        "qty":               int(qty),
        "max_per_instrument": int(max_pos),
        "daily_loss_halt":   int(halt),
        "enabled_symbols":   ["ES=F", "NQ=F"],
    }
    cfg["log_level"] = "INFO"

    save_config(cfg)
    print(f"\nSetup complete. Config saved to {CONFIG_FILE}")
    print("NOTE: Live execution requires Ross to enable it per-user on the dashboard.")
    print("You will run in DEMO mode until live_enabled is granted.\n")
    print("Start the agent with: python signal_agent.py\n")


# ── Main agent loop ───────────────────────────────────────────────────────────

async def run_agent() -> None:
    cfg = load_config()
    if not cfg.get("user_id"):
        print("Not set up yet. Run: python signal_agent.py --setup")
        sys.exit(1)

    setup_logging(cfg.get("log_level", "INFO"))

    jwt = _get_cred("jwt")
    if not jwt:
        logger.error("JWT not found in keyring. Re-run --setup to re-pair.")
        sys.exit(1)

    tv_user = _get_cred("tradovate_username")
    tv_pass = _get_cred("tradovate_password")
    tv_cid  = _get_cred("tradovate_cid")
    tv_sec  = _get_cred("tradovate_sec")

    if not all([tv_user, tv_pass, tv_cid, tv_sec]):
        logger.error("Tradovate credentials incomplete. Re-run --setup.")
        sys.exit(1)

    # Load persistent state
    state           = load_state()
    executed_sigs   = set(state.get("executed_signals", []))
    open_trades     = state.get("open_trades", {})

    # Server entitlement — overwritten on first "entitlement" message
    server_ent: dict = {}
    halted: bool = False

    # Start in DEMO — server entitlement will set live_enabled once it arrives
    tv   = TradovateClient(tv_user, tv_pass, tv_cid, tv_sec, live=False)
    risk = RiskManager(cfg.get("risk", {}), open_trades)

    if not tv.authenticate():
        logger.error("Tradovate authentication failed. Check credentials.")
        sys.exit(1)

    logger.info(f"ICT Signal Agent v{AGENT_VERSION} starting as '{cfg['user_id']}'")

    server_url = cfg["server_url"]
    ws_url     = f"{server_url}?token={jwt}&agent_version={AGENT_VERSION}"
    backoff    = 2

    while True:
        try:
            logger.info(f"Connecting to {server_url}...")
            async with websockets.connect(ws_url, ping_interval=None) as ws:
                logger.info("Connected to signal server")
                backoff = 2
                halted  = False

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "ping":
                        await ws.send(json.dumps({"type": "pong"}))

                    elif msg_type == "entitlement":
                        server_ent = msg
                        new_live   = bool(msg.get("live_enabled", False))
                        if new_live != tv.live:
                            logger.info(
                                f"Server entitlement: switching to "
                                f"{'LIVE' if new_live else 'DEMO'} mode"
                            )
                            tv = TradovateClient(
                                tv_user, tv_pass, tv_cid, tv_sec, live=new_live
                            )
                            tv.authenticate()
                        logger.info(
                            f"Entitlement: tier={msg.get('tier')} "
                            f"max_contracts={msg.get('max_contracts')} "
                            f"live={new_live}"
                        )

                    elif msg_type in ("global_halt", "user_halt"):
                        halted = True
                        logger.warning(
                            f"HALT received from server ({msg_type}): "
                            f"{msg.get('message', '')}"
                        )

                    elif msg_type == "force_disconnect":
                        logger.error(
                            "Server requested disconnect. "
                            "Re-run --setup if your token was revoked."
                        )
                        sys.exit(1)

                    elif msg_type == "signal":
                        if halted:
                            logger.info(
                                f"HALTED — skipping signal {msg.get('signal_id')}"
                            )
                            continue
                        await handle_signal(
                            ws, msg, tv, risk, cfg, server_ent,
                            executed_sigs, state,
                        )

        except websockets.exceptions.ConnectionClosedError as e:
            # Revoked / bad token — don't reconnect
            if e.code in (4001, 4003):
                logger.error(
                    f"Connection rejected (code {e.code}: {e.reason}). "
                    "Re-run --setup to re-pair."
                )
                sys.exit(1)
            logger.warning(f"Connection closed: {e}")

        except Exception as e:
            logger.error(f"Connection error: {e}")

        logger.info(f"Reconnecting in {backoff}s...")
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)
        tv.ensure_auth()


async def handle_signal(
    ws,
    signal:        dict,
    tv:            TradovateClient,
    risk:          RiskManager,
    cfg:           dict,
    server_ent:    dict,
    executed_sigs: set,
    state:         dict,
) -> None:
    symbol    = signal.get("symbol", "")
    direction = signal.get("direction", "")
    sig_id    = signal.get("signal_id", "unknown")

    # Pause flag — agent holds without killing process
    if PAUSE_FLAG.exists():
        logger.info(f"PAUSED — skipping {sig_id}")
        return

    # Signal dedup — prevents re-execution after restart
    if sig_id in executed_sigs:
        logger.info(f"SKIP {sig_id}: already executed (dedup)")
        return

    logger.info(
        f"Signal: {symbol} {direction} {signal.get('timeframe')} "
        f"({signal.get('passed')}/5, conf {signal.get('confidence')}%)"
    )

    # Entitlement filter — server already filtered by symbol/TF, but double-check qty
    effective_qty = min(
        cfg.get("risk", {}).get("qty", 1),
        server_ent.get("max_contracts", 999),
    )

    # Local risk gates
    skip = risk.check(symbol, direction)
    if skip:
        logger.info(f"SKIP {symbol} {direction}: {skip}")
        return

    try:
        tv_symbol = get_front_month(symbol)
    except ValueError as e:
        logger.error(str(e))
        return

    action = "Buy" if direction == "LONG" else "Sell"
    stop   = signal.get("stop_price")
    target = signal.get("target_price")
    entry  = signal.get("entry_price")

    if not all([stop, target, entry]):
        logger.error(f"Signal missing levels: stop={stop} target={target} entry={entry}")
        return

    logger.info(
        f"EXECUTING: {action} {effective_qty} {tv_symbol} | "
        f"stop={stop} target={target}"
    )

    try:
        tv.ensure_auth()
        order    = tv.place_bracket_order(tv_symbol, action, effective_qty, stop, target)
        order_id = order.get("id") or order.get("orderId")

        risk.on_open(symbol)

        trade = {
            "signal_id":      sig_id,
            "symbol":         symbol,
            "direction":      direction,
            "tv_symbol":      tv_symbol,
            "action":         action,
            "qty":            effective_qty,
            "entry_price":    entry,
            "stop_price":     stop,
            "target_price":   target,
            "broker_order_id": str(order_id) if order_id else None,
            "status":         "OPEN",
            "timestamp":      datetime.now(timezone.utc).isoformat(),
            "live":           tv.live,
        }
        log_trade(trade)

        # Persist dedup + open trades
        executed_sigs.add(sig_id)
        if len(executed_sigs) > 100:
            executed_sigs = set(list(executed_sigs)[-100:])
        state["executed_signals"] = list(executed_sigs)
        state["open_trades"]      = risk._open_trades
        save_state(state)

        logger.info(
            f"ORDER PLACED: {tv_symbol} {action} x{effective_qty} "
            f"order_id={order_id} ({'LIVE' if tv.live else 'DEMO'})"
        )

        await ws.send(json.dumps({
            "type":           "status",
            "state":          "executing",
            "open_positions": sum(risk._open_trades.values()),
        }))

    except Exception as e:
        logger.error(f"Execution failed: {e}")
        await ws.send(json.dumps({
            "type":  "status",
            "state": "error",
            "error": str(e)[:200],
        }))


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ICT Signal Agent")
    parser.add_argument("--setup",  action="store_true", help="Run first-time setup wizard")
    parser.add_argument("--status", action="store_true", help="Show config and status")
    args = parser.parse_args()

    if args.setup:
        setup_wizard()
        return

    if args.status:
        cfg = load_config()
        if not cfg:
            print("Not configured. Run: python signal_agent.py --setup")
            return
        jwt      = _get_cred("jwt")
        tv_user  = _get_cred("tradovate_username")
        state    = load_state()
        print(f"\nUser:         {cfg.get('user_id', 'unknown')}")
        print(f"Server:       {cfg.get('server_url', 'unknown')}")
        print(f"JWT:          {'configured' if jwt else 'MISSING — re-run --setup'}")
        print(f"Tradovate:    {'configured' if tv_user else 'MISSING — re-run --setup'}")
        print(f"Paused:       {'YES' if PAUSE_FLAG.exists() else 'no'}")
        print(f"Open trades:  {state.get('open_trades', {})}")
        print(f"Signals seen: {len(state.get('executed_signals', []))}")
        print(f"Risk:         {json.dumps(cfg.get('risk', {}), indent=2)}")
        print(f"Config:       {CONFIG_FILE}")
        print(f"Log:          {LOG_FILE}\n")
        return

    asyncio.run(run_agent())


if __name__ == "__main__":
    main()
