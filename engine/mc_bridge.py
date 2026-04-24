"""Bridge between RoceOS Execution Engine and Mission Control.

Handles:
- Agent registration via POST /api/connect
- SSE event listening for incoming chat messages
- Posting replies back via POST /api/chat/messages
- Periodic heartbeat reporting
"""
import asyncio
import json
import logging

import httpx

from config import settings

logger = logging.getLogger("roceos.mc_bridge")


class MCBridge:
    """Manages the connection between the execution engine and Mission Control."""

    def __init__(self):
        self.agent_id: str | None = None
        self.connection_id: str | None = None
        self.api_key: str = settings.mc_api_key
        self.base_url: str = settings.mc_api_url
        self._heartbeat_task: asyncio.Task | None = None
        self._listener_task: asyncio.Task | None = None
        self._message_handler = None
        self._client = httpx.AsyncClient(timeout=30.0)

    @property
    def headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["x-api-key"] = self.api_key
        return h

    async def connect(self, agent_name: str = "roceos-engine"):
        """Register with Mission Control and start heartbeat."""
        try:
            resp = await self._client.post(
                f"{self.base_url}/connect",
                json={
                    "tool_name": "roceos-execution-engine",
                    "tool_version": "0.1.0",
                    "agent_name": agent_name,
                    "agent_role": "agent",
                },
                headers=self.headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                self.agent_id = data.get("agent_id")
                self.connection_id = data.get("connection_id")
                logger.info(
                    f"Connected to MC: agent_id={self.agent_id}, "
                    f"connection_id={self.connection_id}"
                )
                return True
            else:
                logger.warning(
                    f"MC connect failed: {resp.status_code} {resp.text}"
                )
                return False
        except Exception as e:
            logger.warning(f"MC connect error (MC may not be ready yet): {e}")
            return False

    async def start_heartbeat(self, interval: int = 30):
        """Start periodic heartbeat to MC."""
        async def _heartbeat_loop():
            while True:
                await asyncio.sleep(interval)
                try:
                    if self.agent_id:
                        await self._client.post(
                            f"{self.base_url}/agents/{self.agent_id}/heartbeat",
                            json={
                                "connection_id": self.connection_id,
                                "status": "idle",
                            },
                            headers=self.headers,
                        )
                except Exception as e:
                    logger.debug(f"Heartbeat failed: {e}")

        self._heartbeat_task = asyncio.create_task(_heartbeat_loop())

    async def start_event_listener(self, message_handler):
        """Listen for SSE events from MC (chat messages directed to us)."""
        self._message_handler = message_handler

        async def _listen():
            while True:
                try:
                    async with self._client.stream(
                        "GET",
                        f"{self.base_url}/events",
                        headers={
                            **self.headers,
                            "Accept": "text/event-stream",
                        },
                        timeout=None,
                    ) as response:
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                try:
                                    event = json.loads(line[6:])
                                    await self._handle_event(event)
                                except json.JSONDecodeError:
                                    pass
                except Exception as e:
                    logger.debug(f"SSE listener error: {e}")
                    await asyncio.sleep(5)  # Reconnect after delay

        self._listener_task = asyncio.create_task(_listen())

    async def _handle_event(self, event: dict):
        """Process an incoming SSE event from MC."""
        event_type = event.get("type", "")

        if event_type == "chat.message":
            data = event.get("data", {})
            to_agent = data.get("to_agent", "")

            # Only handle messages directed to us
            if to_agent == "roceos-engine" and self._message_handler:
                await self._message_handler(
                    conversation_id=data.get("conversation_id"),
                    content=data.get("content", ""),
                    from_user=data.get("from_agent", "user"),
                )

    async def send_reply(
        self,
        conversation_id: str,
        content: str,
        from_agent: str = "roceos-engine",
    ):
        """Post a reply message back to MC."""
        try:
            await self._client.post(
                f"{self.base_url}/chat/messages",
                json={
                    "from": from_agent,
                    "to": "user",
                    "conversation_id": conversation_id,
                    "content": content,
                    "message_type": "text",
                },
                headers=self.headers,
            )
        except Exception as e:
            logger.error(f"Failed to send reply to MC: {e}")

    async def disconnect(self):
        """Clean up connections."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._listener_task:
            self._listener_task.cancel()
        await self._client.aclose()


# Global bridge instance
bridge = MCBridge()
