"""
Tradovate Execution Client — Micro Futures (MES, MNQ)

Handles authentication, order placement, position queries, and order management
via the Tradovate REST API. Designed for automated execution from the ICT scanner.

Endpoints:
  Demo: https://demo.tradovateapi.com/v1
  Live: https://live.tradovateapi.com/v1

Auth: POST /auth/accesstokenrequest with username/password + cid/sec (API key).
Tokens expire after 90 minutes; renew via GET /auth/renewaccesstoken.
CME requires isAutomated=true on all bot-placed orders.
"""

import os
import json
import time
import logging
from datetime import datetime, timezone

try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger("tradovate")

DEMO_URL = "https://demo.tradovateapi.com/v1"
LIVE_URL = "https://live.tradovateapi.com/v1"

# Map scanner symbols to Tradovate contract names
# Tradovate uses contract-month format: MESM6 = Micro ES June 2026
SYMBOL_MAP = {
    "ES=F": "MES",   # Micro E-mini S&P 500
    "NQ=F": "MNQ",   # Micro E-mini Nasdaq 100
}

# Point values per contract (for P&L calculation)
POINT_VALUES = {
    "MES": 5.0,    # $5 per point (micro ES)
    "MNQ": 2.0,    # $2 per point (micro NQ)
}


class TradovateClient:
    """REST client for Tradovate futures API."""

    def __init__(self, username, password, cid, sec, live=False):
        if httpx is None:
            raise ImportError("httpx required: pip install httpx")

        self.base_url = LIVE_URL if live else DEMO_URL
        self.username = username
        self.password = password
        self.cid = cid
        self.sec = sec
        self.live = live

        self.access_token = None
        self.md_access_token = None
        self.token_expiry = 0
        self.account_id = None
        self.user_id = None

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }

    # ── Auth ──────────────────────────────────────────────────────────────────

    def authenticate(self) -> bool:
        """Get access token. Returns True on success."""
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{self.base_url}/auth/accesstokenrequest", json={
                "name": self.username,
                "password": self.password,
                "appId": "RoceOS-Scanner",
                "appVersion": "1.0",
                "cid": self.cid,
                "sec": self.sec,
            })

        data = resp.json()
        if data.get("errorText"):
            logger.error(f"Auth failed: {data['errorText']}")
            return False

        self.access_token = data["accessToken"]
        self.md_access_token = data.get("mdAccessToken")
        self.user_id = data.get("userId")
        # Tokens last 90 min; renew at 75 min
        self.token_expiry = time.time() + (75 * 60)
        logger.info(f"Authenticated as {self.username} ({'LIVE' if self.live else 'DEMO'})")

        # Cache account ID
        accounts = self.get_accounts()
        if accounts:
            self.account_id = accounts[0]["id"]
            logger.info(f"Account ID: {self.account_id} ({accounts[0].get('name')})")

        return True

    def ensure_auth(self):
        """Renew token if near expiry, or re-authenticate."""
        if self.access_token and time.time() < self.token_expiry:
            return
        if self.access_token:
            # Try renewal first
            try:
                with httpx.Client(timeout=10) as client:
                    resp = client.get(
                        f"{self.base_url}/auth/renewaccesstoken",
                        headers=self._headers(),
                    )
                    data = resp.json()
                    if data.get("accessToken"):
                        self.access_token = data["accessToken"]
                        self.token_expiry = time.time() + (75 * 60)
                        logger.debug("Token renewed")
                        return
            except Exception:
                pass
        # Full re-auth
        self.authenticate()

    # ── Account ───────────────────────────────────────────────────────────────

    def get_accounts(self) -> list:
        """List all accounts."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{self.base_url}/account/list", headers=self._headers())
        return resp.json()

    def get_cash_balance(self) -> dict:
        """Get current cash balance snapshot."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{self.base_url}/cashBalance/getcashbalancesnapshot",
                headers=self._headers(),
                json={"accountId": self.account_id},
            )
        return resp.json()

    # ── Positions ─────────────────────────────────────────────────────────────

    def get_positions(self) -> list:
        """List all open positions."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{self.base_url}/position/list", headers=self._headers())
        return resp.json()

    # ── Contracts ─────────────────────────────────────────────────────────────

    def find_contract(self, name: str) -> dict | None:
        """Find a contract by name (e.g., 'MESM6'). Returns contract dict or None."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self.base_url}/contract/suggest",
                headers=self._headers(),
                params={"t": name, "l": 1},
            )
        results = resp.json()
        return results[0] if results else None

    # ── Orders ────────────────────────────────────────────────────────────────

    def place_market_order(self, symbol: str, action: str, qty: int = 1) -> dict:
        """Place a market order. action = 'Buy' or 'Sell'."""
        self.ensure_auth()
        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{self.base_url}/order/placeorder", headers=self._headers(), json={
                "accountSpec": self.username,
                "accountId": self.account_id,
                "action": action,
                "symbol": symbol,
                "orderQty": qty,
                "orderType": "Market",
                "timeInForce": "Day",
                "isAutomated": True,
            })
        data = resp.json()
        logger.info(f"Market order: {action} {qty} {symbol} → {data.get('ordStatus', 'UNKNOWN')}")
        return data

    def place_bracket_order(self, symbol: str, action: str, qty: int,
                           stop_price: float, target_price: float) -> dict:
        """Place an OSO bracket order: market entry + stop loss + take profit.
        This is the primary order type for the scanner."""
        self.ensure_auth()

        # Bracket exit is opposite of entry
        exit_action = "Sell" if action == "Buy" else "Buy"

        with httpx.Client(timeout=15) as client:
            resp = client.post(f"{self.base_url}/order/placeoso", headers=self._headers(), json={
                "accountSpec": self.username,
                "accountId": self.account_id,
                "action": action,
                "symbol": symbol,
                "orderQty": qty,
                "orderType": "Market",
                "timeInForce": "Day",
                "isAutomated": True,
                "bracket1": {
                    "action": exit_action,
                    "orderType": "Stop",
                    "stopPrice": stop_price,
                    "qty": qty,
                    "timeInForce": "GTC",
                    "isAutomated": True,
                },
                "bracket2": {
                    "action": exit_action,
                    "orderType": "Limit",
                    "price": target_price,
                    "qty": qty,
                    "timeInForce": "GTC",
                    "isAutomated": True,
                },
            })
        data = resp.json()
        logger.info(f"Bracket order: {action} {qty} {symbol} | "
                    f"stop {stop_price} target {target_price} → {data.get('ordStatus', 'UNKNOWN')}")
        return data

    def cancel_order(self, order_id: int) -> dict:
        """Cancel an open order."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{self.base_url}/order/cancelorder",
                headers=self._headers(),
                json={"orderId": order_id},
            )
        return resp.json()

    def get_orders(self) -> list:
        """List all orders."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{self.base_url}/order/list", headers=self._headers())
        return resp.json()

    def liquidate_position(self, account_id: int = None) -> dict:
        """Emergency liquidate all positions on the account."""
        self.ensure_auth()
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{self.base_url}/order/liquidateposition",
                headers=self._headers(),
                json={"accountId": account_id or self.account_id},
            )
        data = resp.json()
        logger.warning(f"LIQUIDATE ALL: {data}")
        return data


def get_front_month_symbol(scanner_symbol: str) -> str:
    """Convert scanner symbol (ES=F) to Tradovate front-month contract (MESM6).
    Uses current date to determine the active contract month."""
    base = SYMBOL_MAP.get(scanner_symbol)
    if not base:
        raise ValueError(f"Unknown scanner symbol: {scanner_symbol}")

    # CME futures months: H=Mar, M=Jun, U=Sep, Z=Dec
    month_codes = {3: "H", 6: "M", 9: "U", 12: "Z"}
    now = datetime.now(timezone.utc)
    year_digit = now.year % 10

    # Find the nearest front-month contract
    for m in [3, 6, 9, 12]:
        if now.month <= m:
            return f"{base}{month_codes[m]}{year_digit}"

    # Past December → next year's March
    return f"{base}H{(year_digit + 1) % 10}"
