#!/usr/bin/env python3
"""
ICT Signal Agent — Automated Futures Execution

Connects to the ICT Signal Server, receives trading signals,
and executes bracket orders on your Tradovate account.

Your broker credentials never leave this machine.

First run:  python signal_agent.py --setup
Normal run: python signal_agent.py

Config: ~/.ict-agent/config.json
Logs:   ~/.ict-agent/agent.log
"""

import argparse
import asyncio
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
except ImportError:
    print("Missing dependency: pip install websockets")
    sys.exit(1)

try:
    import keyring
except ImportError:
    keyring = None

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_DIR = Path.home() / ".ict-agent"
CONFIG_FILE = CONFIG_DIR / "config.json"
LOG_FILE = CONFIG_DIR / "agent.log"
TRADES_FILE = CONFIG_DIR / "trades.json"
KEYRING_SERVICE = "ict-agent"

DEFAULT_SERVER = "wss://api.ictwealthbuilding.com/ws/signals"

DEFAULT_RISK = {
    "qty": 1,
    "max_per_instrument": 2,
    "daily_loss_halt": 3,
    "enabled_symbols": ["ES=F", "NQ=F"],
    "live_mode": True,
}

# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logging(level="INFO"):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler(),
        ],
    )

logger = logging.getLogger("ict-agent")

# ── Tradovate Client (inlined) ────────────────────────────────────────────────

TRADOVATE_DEMO_URL = "https://demo.tradovateapi.com/v1"
TRADOVATE_LIVE_URL = "https://live.tradovateapi.com/v1"

SYMBOL_MAP = {"ES=F": "MES", "NQ=F": "MNQ"}
POINT_VALUES = {"MES": 5.0, "MNQ": 2.0}


class TradovateClient:
    """Minimal Tradovate REST client for bracket order execution."""

    def __init__(self, username, password, cid, sec, live=False):
        self.base_url = TRADOVATE_LIVE_URL if live else TRADOVATE_DEMO_URL
        self.username = username
        self.password = password
        self.cid = cid
        self.sec = sec
        self.live = live
        self.access_token = None
        self.token_expiry = 0
        self.account_id = None

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }

    def authenticate(self) -> bool:
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{self.base_url}/auth/accesstokenrequest", json={
                "name": self.username, "password": self.password,
                "appId": "ICT-Agent", "appVersion": "1.0",
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
        logger.info(f"Tradovate authenticated ({'LIVE' if self.live else 'DEMO'})")
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

    def _get(self, path):
        self.ensure_auth() if self.access_token else None
        with httpx.Client(timeout=10) as client:
            return client.get(f"{self.base_url}{path}", headers=self._headers()).json()

    def _post(self, path, body):
        self.ensure_auth()
        with httpx.Client(timeout=15) as client:
            return client.post(f"{self.base_url}{path}", headers=self._headers(), json=body).json()

    def get_positions(self) -> list:
        return self._get("/position/list")

    def place_bracket_order(self, symbol, action, qty, stop_price, target_price) -> dict:
        exit_action = "Sell" if action == "Buy" else "Buy"
        return self._post("/order/placeoso", {
            "accountSpec": self.username, "accountId": self.account_id,
            "action": action, "symbol": symbol, "orderQty": qty,
            "orderType": "Market", "timeInForce": "Day", "isAutomated": True,
            "bracket1": {
                "action": exit_action, "orderType": "Stop",
                "stopPrice": stop_price, "qty": qty,
                "timeInForce": "GTC", "isAutomated": True,
            },
            "bracket2": {
                "action": exit_action, "orderType": "Limit",
                "price": target_price, "qty": qty,
                "timeInForce": "GTC", "isAutomated": True,
            },
        })


def _third_friday(year: int, month: int) -> date:
    """Return the date of the third Friday of the given month."""
    d = date(year, month, 1)
    days_to_first_friday = (4 - d.weekday()) % 7
    return d + timedelta(days=days_to_first_friday + 14)


def get_front_month(scanner_symbol: str) -> str:
    """Convert scanner symbol (ES=F) to Tradovate front-month contract (MESM6).
    Rolls 8 calendar days before the 3rd-Friday CME expiry."""
    base = SYMBOL_MAP.get(scanner_symbol)
    if not base:
        raise ValueError(f"Unknown symbol: {scanner_symbol}")

    EXPIRY_MONTHS = [3, 6, 9, 12]
    MONTH_CODE    = {3: "H", 6: "M", 9: "U", 12: "Z"}
    ROLL_DAYS     = 8

    today = datetime.now(timezone.utc).date()

    for m in EXPIRY_MONTHS:
        year = today.year
        if m < today.month:
            continue
        roll_date = _third_friday(year, m) - timedelta(days=ROLL_DAYS)
        if today < roll_date:
            return f"{base}{MONTH_CODE[m]}{year % 10}"

    next_year = today.year + 1
    return f"{base}H{next_year % 10}"


# ── Credential Storage ────────────────────────────────────────────────────────

def _store_credential(key, value):
    if keyring:
        keyring.set_password(KEYRING_SERVICE, key, value)
    else:
        # Fallback: store in config (less secure, warn user)
        cfg = load_config()
        if "_creds" not in cfg:
            cfg["_creds"] = {}
        cfg["_creds"][key] = value
        save_config(cfg)


def _get_credential(key):
    if keyring:
        return keyring.get_password(KEYRING_SERVICE, key)
    else:
        cfg = load_config()
        return cfg.get("_creds", {}).get(key)


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save_config(cfg: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


# ── Risk Manager ──────────────────────────────────────────────────────────────

class RiskManager:
    """Local risk gates — mirrors server-side logic."""

    def __init__(self, risk_config: dict):
        self.max_per_instrument = risk_config.get("max_per_instrument", 2)
        self.daily_loss_halt = risk_config.get("daily_loss_halt", 3)
        self.enabled_symbols = risk_config.get("enabled_symbols", ["ES=F", "NQ=F"])
        self.qty = risk_config.get("qty", 1)

        # Track state locally
        self._open_trades: dict[str, int] = {}  # symbol -> count
        self._daily_losses: dict[str, int] = {}  # symbol -> count today
        self._today: str = ""

    def _reset_daily(self):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today != self._today:
            self._daily_losses = {}
            self._today = today

    def check(self, symbol: str, direction: str) -> str | None:
        """Returns None if OK, or skip reason."""
        self._reset_daily()

        if symbol not in self.enabled_symbols:
            return f"symbol {symbol} not enabled"

        if self._open_trades.get(symbol, 0) >= self.max_per_instrument:
            return f"position cap ({self._open_trades[symbol]}/{self.max_per_instrument})"

        if self._daily_losses.get(symbol, 0) >= self.daily_loss_halt:
            return f"daily halt ({self._daily_losses[symbol]} losses today)"

        return None

    def on_trade_open(self, symbol: str):
        self._open_trades[symbol] = self._open_trades.get(symbol, 0) + 1

    def on_trade_close(self, symbol: str, is_loss: bool):
        self._open_trades[symbol] = max(0, self._open_trades.get(symbol, 0) - 1)
        if is_loss:
            self._reset_daily()
            self._daily_losses[symbol] = self._daily_losses.get(symbol, 0) + 1


# ── Trade Ledger ──────────────────────────────────────────────────────────────

def log_trade(trade: dict):
    """Append trade to local ledger."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    trades = []
    if TRADES_FILE.exists():
        try:
            trades = json.loads(TRADES_FILE.read_text())
        except Exception:
            pass
    trades.append(trade)
    # Keep last 500 trades
    TRADES_FILE.write_text(json.dumps(trades[-500:], indent=2))


# ── Setup Wizard ──────────────────────────────────────────────────────────────

def setup_wizard():
    """Interactive first-run setup."""
    print("\n=== ICT Signal Agent Setup ===\n")

    cfg = load_config()

    # Step 1: Pairing token
    server = input(f"Signal server URL [{DEFAULT_SERVER}]: ").strip() or DEFAULT_SERVER
    token = input("Pairing token (from Ross): ").strip()

    if not token:
        print("Error: pairing token required.")
        sys.exit(1)

    # Exchange token for JWT
    pair_url = server.replace("wss://", "https://").replace("/ws/signals", "")
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{pair_url}/api/pair", json={
                "pairing_token": token,
                "agent_version": "1.0.0",
                "hostname": os.environ.get("COMPUTERNAME", os.uname().nodename if hasattr(os, "uname") else "unknown"),
            })
        if resp.status_code != 200:
            print(f"Pairing failed: {resp.json().get('detail', resp.text)}")
            sys.exit(1)
        data = resp.json()
        print(f"\nPaired successfully as: {data['display_name']} ({data['user_id']})")
    except Exception as e:
        print(f"Pairing error: {e}")
        sys.exit(1)

    cfg["server_url"] = server
    cfg["jwt"] = data["jwt"]
    cfg["user_id"] = data["user_id"]

    # Step 2: Tradovate credentials
    print("\n--- Tradovate Credentials ---")
    print("These are stored locally in your OS credential manager.\n")

    tv_user = input("Tradovate username: ").strip()
    tv_pass = input("Tradovate password: ").strip()
    tv_cid = input("API Client ID (cid): ").strip()
    tv_sec = input("API Secret (sec): ").strip()

    if not all([tv_user, tv_pass, tv_cid, tv_sec]):
        print("Error: all Tradovate credentials required.")
        sys.exit(1)

    _store_credential("tradovate_username", tv_user)
    _store_credential("tradovate_password", tv_pass)
    _store_credential("tradovate_cid", tv_cid)
    _store_credential("tradovate_sec", tv_sec)

    # Test Tradovate connection
    print("\nTesting Tradovate connection...")
    try:
        tc = TradovateClient(tv_user, tv_pass, tv_cid, tv_sec, live=True)
        if tc.authenticate():
            print(f"Tradovate connected! Account ID: {tc.account_id}")
        else:
            print("Warning: Tradovate auth failed. Check credentials. You can re-run --setup later.")
    except Exception as e:
        print(f"Warning: Tradovate test failed: {e}")

    # Step 3: Risk config
    print("\n--- Risk Settings ---")
    qty = input("Contracts per trade [1]: ").strip() or "1"
    max_pos = input("Max open trades per instrument [2]: ").strip() or "2"
    halt = input("Daily loss halt (losses before stopping) [3]: ").strip() or "3"

    cfg["risk"] = {
        "qty": int(qty),
        "max_per_instrument": int(max_pos),
        "daily_loss_halt": int(halt),
        "enabled_symbols": ["ES=F", "NQ=F"],
        "live_mode": True,
    }

    cfg["log_level"] = "INFO"
    save_config(cfg)

    print(f"\nSetup complete! Config saved to {CONFIG_FILE}")
    print("Run the agent with: python signal_agent.py\n")


# ── Main Agent Loop ───────────────────────────────────────────────────────────

async def run_agent():
    """Main agent loop — connect to signal server, receive and execute signals."""
    cfg = load_config()

    if not cfg.get("jwt"):
        print("Not set up yet. Run: python signal_agent.py --setup")
        sys.exit(1)

    setup_logging(cfg.get("log_level", "INFO"))
    logger.info(f"ICT Signal Agent starting as {cfg.get('user_id')}")

    # Load Tradovate credentials
    tv_user = _get_credential("tradovate_username")
    tv_pass = _get_credential("tradovate_password")
    tv_cid = _get_credential("tradovate_cid")
    tv_sec = _get_credential("tradovate_sec")

    if not all([tv_user, tv_pass, tv_cid, tv_sec]):
        logger.error("Tradovate credentials not found. Run --setup again.")
        sys.exit(1)

    # Initialize Tradovate client
    live_mode = cfg.get("risk", {}).get("live_mode", True)
    tv = TradovateClient(tv_user, tv_pass, tv_cid, tv_sec, live=live_mode)

    if not tv.authenticate():
        logger.error("Tradovate authentication failed. Check credentials.")
        sys.exit(1)

    # Initialize risk manager
    risk = RiskManager(cfg.get("risk", DEFAULT_RISK))

    # WebSocket connection with auto-reconnect
    server_url = cfg["server_url"]
    ws_url = f"{server_url}?token={cfg['jwt']}"
    backoff = 2

    while True:
        try:
            logger.info(f"Connecting to {server_url}...")
            async with websockets.connect(ws_url, ping_interval=None) as ws:
                logger.info("Connected to signal server")
                backoff = 2  # Reset backoff on successful connect

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type")

                    if msg_type == "ping":
                        await ws.send(json.dumps({"type": "pong"}))

                    elif msg_type == "signal":
                        await handle_signal(ws, msg, tv, risk, cfg)

        except websockets.ConnectionClosedError as e:
            logger.warning(f"Connection closed: {e}")
        except Exception as e:
            logger.error(f"Connection error: {e}")

        logger.info(f"Reconnecting in {backoff}s...")
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)

        # Re-auth Tradovate on reconnect
        tv.ensure_auth()


async def handle_signal(ws, signal: dict, tv: TradovateClient, risk: RiskManager, cfg: dict):
    """Process an incoming signal — apply risk gates, execute, report result."""
    symbol = signal.get("symbol")
    direction = signal.get("direction")
    signal_id = signal.get("signal_id", "unknown")

    logger.info(f"Signal received: {symbol} {direction} {signal.get('timeframe')} "
                f"({signal.get('passed')}/5, conf {signal.get('confidence')}%)")

    # Risk gate check
    skip = risk.check(symbol, direction)
    if skip:
        logger.info(f"SKIP {symbol} {direction}: {skip}")
        return

    # Map to Tradovate contract
    try:
        tv_symbol = get_front_month(symbol)
    except ValueError as e:
        logger.error(str(e))
        return

    action = "Buy" if direction == "LONG" else "Sell"
    qty = cfg.get("risk", {}).get("qty", 1)
    stop = signal.get("stop_price")
    target = signal.get("target_price")
    entry = signal.get("entry_price")

    if not all([stop, target, entry]):
        logger.error(f"Signal missing trade levels: stop={stop} target={target} entry={entry}")
        return

    logger.info(f"EXECUTING: {action} {qty} {tv_symbol} | stop {stop} target {target}")

    try:
        tv.ensure_auth()
        order = tv.place_bracket_order(tv_symbol, action, qty, stop, target)
        order_id = order.get("id") or order.get("orderId")

        risk.on_trade_open(symbol)

        trade = {
            "signal_id": signal_id,
            "symbol": symbol,
            "direction": direction,
            "tv_symbol": tv_symbol,
            "action": action,
            "qty": qty,
            "entry_price": entry,
            "stop_price": stop,
            "target_price": target,
            "broker_order_id": str(order_id) if order_id else None,
            "status": "OPEN",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        log_trade(trade)

        logger.info(f"ORDER PLACED: {tv_symbol} {action} #{order_id}")

        # Report to server
        await ws.send(json.dumps({
            "type": "status",
            "state": "executing",
            "open_positions": sum(risk._open_trades.values()),
        }))

    except Exception as e:
        logger.error(f"Execution failed: {e}")

        await ws.send(json.dumps({
            "type": "status",
            "state": "error",
            "error": str(e),
        }))


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ICT Signal Agent")
    parser.add_argument("--setup", action="store_true", help="Run first-time setup wizard")
    parser.add_argument("--status", action="store_true", help="Show current config and status")
    args = parser.parse_args()

    if args.setup:
        setup_wizard()
        return

    if args.status:
        cfg = load_config()
        if not cfg:
            print("Not configured. Run: python signal_agent.py --setup")
            return
        print(f"\nUser: {cfg.get('user_id')}")
        print(f"Server: {cfg.get('server_url')}")
        print(f"Risk: {json.dumps(cfg.get('risk', {}), indent=2)}")
        print(f"JWT: {'configured' if cfg.get('jwt') else 'missing'}")
        tv_user = _get_credential("tradovate_username")
        print(f"Tradovate: {'configured' if tv_user else 'missing'}")
        print(f"Config: {CONFIG_FILE}")
        print(f"Log: {LOG_FILE}\n")
        return

    asyncio.run(run_agent())


if __name__ == "__main__":
    main()
