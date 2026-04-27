"""WebSocket connection manager for signal broadcasting."""

import asyncio
import logging
from datetime import datetime, timezone
from fastapi import WebSocket

logger = logging.getLogger("signal_ws")


class ConnectionManager:
    """Manages authenticated WebSocket connections for signal delivery.

    Each connected agent has an entitlement dict that controls which signals
    it receives. Signals are filtered per-user on broadcast — not globally.
    """

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}
        self._entitlements: dict[str, dict] = {}   # user_id -> entitlement
        self._daily_counts: dict[str, int] = {}    # user_id -> signals delivered today
        self._count_date: str = ""                 # YYYY-MM-DD of current counts

    @property
    def connected_count(self) -> int:
        return len(self._connections)

    @property
    def connected_users(self) -> list[str]:
        return list(self._connections.keys())

    def connect(self, user_id: str, websocket: WebSocket, entitlement: dict = None):
        if user_id in self._connections:
            logger.info(f"Replacing existing connection for {user_id}")
        self._connections[user_id] = websocket
        self._entitlements[user_id] = entitlement or {}
        logger.info(f"Agent connected: {user_id} (total: {self.connected_count})")

    def disconnect(self, user_id: str):
        self._connections.pop(user_id, None)
        self._entitlements.pop(user_id, None)
        logger.info(f"Agent disconnected: {user_id} (total: {self.connected_count})")

    def update_entitlement(self, user_id: str, entitlement: dict):
        """Live-update a connected agent's entitlement without disconnect."""
        self._entitlements[user_id] = entitlement

    def _reset_daily_counts_if_needed(self):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today != self._count_date:
            self._daily_counts = {}
            self._count_date = today

    async def broadcast(self, message: dict) -> int:
        """Send a message to all agents that pass entitlement filters.

        Signal messages are filtered by:
          - allowed_symbols / allowed_timeframes
          - max_per_day (in-memory daily counter, resets at UTC midnight)
          - expired entitlement (max_per_day forced to 0)
        Non-signal messages (ping, global_halt, etc.) reach everyone.
        """
        if not self._connections:
            return 0

        if message.get("type") == "signal":
            self._reset_daily_counts_if_needed()

        delivered = 0
        failed = []

        for user_id, ws in self._connections.items():
            if message.get("type") == "signal":
                ent = self._entitlements.get(user_id, {})

                # Expired subscription — no signals
                if ent.get("expired"):
                    logger.debug(f"Skipping {user_id}: subscription expired")
                    continue

                # Symbol / timeframe filter
                allowed_symbols    = ent.get("allowed_symbols")
                allowed_timeframes = ent.get("allowed_timeframes")
                if allowed_symbols and message.get("symbol") not in allowed_symbols:
                    continue
                if allowed_timeframes and message.get("timeframe") not in allowed_timeframes:
                    continue

                # Daily signal cap
                max_per_day = ent.get("max_per_day", 5)
                today_count = self._daily_counts.get(user_id, 0)
                if max_per_day > 0 and today_count >= max_per_day:
                    logger.warning(
                        f"Daily cap reached for {user_id}: {today_count}/{max_per_day} signals today"
                    )
                    continue

            try:
                await ws.send_json(message)
                delivered += 1
                if message.get("type") == "signal":
                    self._daily_counts[user_id] = self._daily_counts.get(user_id, 0) + 1
            except Exception as e:
                logger.warning(f"Send failed to {user_id}: {e}")
                failed.append(user_id)

        for user_id in failed:
            self.disconnect(user_id)

        if delivered:
            logger.info(f"Broadcast to {delivered}/{self.connected_count + len(failed)} agent(s)")
        return delivered

    async def send_to(self, user_id: str, message: dict) -> bool:
        """Send a message to one specific agent."""
        ws = self._connections.get(user_id)
        if not ws:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            logger.warning(f"Send to {user_id} failed: {e}")
            self.disconnect(user_id)
            return False

    async def heartbeat_loop(self):
        """Ping all clients every 30 seconds. Run as a background task."""
        while True:
            await asyncio.sleep(30)
            if not self._connections:
                continue

            ping = {"type": "ping", "ts": datetime.now(timezone.utc).isoformat()}
            failed = []
            for user_id, ws in self._connections.items():
                try:
                    await ws.send_json(ping)
                except Exception:
                    failed.append(user_id)
            for user_id in failed:
                self.disconnect(user_id)


# Singleton
manager = ConnectionManager()
