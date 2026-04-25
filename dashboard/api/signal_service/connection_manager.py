"""WebSocket connection manager for signal broadcasting."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from fastapi import WebSocket

logger = logging.getLogger("signal_ws")


class ConnectionManager:
    """Manages authenticated WebSocket connections for signal delivery."""

    def __init__(self):
        # user_id -> WebSocket
        self._connections: dict[str, WebSocket] = {}

    @property
    def connected_count(self) -> int:
        return len(self._connections)

    @property
    def connected_users(self) -> list[str]:
        return list(self._connections.keys())

    def connect(self, user_id: str, websocket: WebSocket):
        """Register a connection. Replaces existing connection for same user."""
        if user_id in self._connections:
            logger.info(f"Replacing existing connection for {user_id}")
        self._connections[user_id] = websocket
        logger.info(f"Agent connected: {user_id} (total: {self.connected_count})")

    def disconnect(self, user_id: str):
        """Remove a connection."""
        self._connections.pop(user_id, None)
        logger.info(f"Agent disconnected: {user_id} (total: {self.connected_count})")

    async def broadcast(self, message: dict) -> int:
        """Send a message to all connected agents. Returns number delivered."""
        if not self._connections:
            return 0

        delivered = 0
        failed = []

        for user_id, ws in self._connections.items():
            try:
                await ws.send_json(message)
                delivered += 1
            except Exception as e:
                logger.warning(f"Send failed to {user_id}: {e}")
                failed.append(user_id)

        # Clean up broken connections
        for user_id in failed:
            self.disconnect(user_id)

        if delivered:
            logger.info(f"Broadcast signal to {delivered} agent(s)")
        return delivered

    async def send_to(self, user_id: str, message: dict) -> bool:
        """Send a message to a specific agent."""
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
        """Send pings to all clients every 30 seconds. Run as background task."""
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


# Singleton instance
manager = ConnectionManager()
