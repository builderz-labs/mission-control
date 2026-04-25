"""RoceOS Notification Router — controls when and how scheduler output reaches Ross."""
import logging
import sqlite3
import time
from datetime import datetime
from enum import Enum
from zoneinfo import ZoneInfo

from config import settings

logger = logging.getLogger("roceos.scheduler.notify")

CDT = ZoneInfo("America/Chicago")


class NotifyLevel(str, Enum):
    CRITICAL = "critical"     # Always send, even during quiet hours
    BRIEFING = "briefing"     # Scheduled summaries — always send (but respect quiet hours)
    CONDITIONAL = "conditional"  # Only send if content is actionable
    SILENT = "silent"         # Never send to Telegram


class NotificationRouter:
    """Routes scheduler job output to Telegram based on level, quiet hours, and rate limits."""

    def __init__(self, send_fn, db_path: str | None = None):
        """
        Args:
            send_fn: Async function to send Telegram message: async def send(text, user_id=None) -> bool
            db_path: Optional SQLite path for rate limit tracking
        """
        self._send = send_fn
        self._db_path = db_path
        self._recent_sends: list[float] = []  # timestamps of recent sends
        self._max_per_hour = 10
        self._quiet_start = 22  # 10 PM CDT
        self._quiet_end = 6     # 6 AM CDT (briefing at 7 is after quiet hours)

        if db_path:
            self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                job_id TEXT,
                level TEXT,
                message_length INTEGER,
                sent INTEGER DEFAULT 1
            )
        """)
        conn.commit()
        conn.close()

    def _is_quiet_hours(self) -> bool:
        """Check if we're in quiet hours (CDT)."""
        now = datetime.now(CDT)
        h = now.hour
        return h >= self._quiet_start or h < self._quiet_end

    def _is_rate_limited(self) -> bool:
        """Check if we've exceeded max notifications per hour."""
        now = time.time()
        cutoff = now - 3600
        self._recent_sends = [t for t in self._recent_sends if t > cutoff]
        return len(self._recent_sends) >= self._max_per_hour

    def _log_notification(self, job_id: str, level: str, length: int, sent: bool):
        if not self._db_path:
            return
        try:
            conn = sqlite3.connect(self._db_path, timeout=10)
            conn.execute(
                "INSERT INTO notification_log (job_id, level, message_length, sent) VALUES (?, ?, ?, ?)",
                (job_id, level, length, int(sent)),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to log notification: {e}")

    async def route(
        self,
        job_id: str,
        level: NotifyLevel,
        message: str,
    ) -> bool:
        """Route a message based on notification level, quiet hours, and rate limits.

        Returns True if message was sent, False if suppressed.
        """
        # Silent — never send
        if level == NotifyLevel.SILENT:
            self._log_notification(job_id, level.value, len(message), False)
            return False

        # Empty or NO_REPLY — suppress
        if not message or not message.strip() or message.strip().upper() == "NO_REPLY":
            self._log_notification(job_id, level.value, 0, False)
            return False

        # Quiet hours — only CRITICAL breaks through
        if self._is_quiet_hours() and level != NotifyLevel.CRITICAL:
            logger.info(f"Suppressed {job_id} ({level.value}) — quiet hours")
            self._log_notification(job_id, level.value, len(message), False)
            return False

        # Rate limit — only CRITICAL breaks through
        if self._is_rate_limited() and level != NotifyLevel.CRITICAL:
            logger.warning(f"Suppressed {job_id} ({level.value}) — rate limited")
            self._log_notification(job_id, level.value, len(message), False)
            return False

        # Send it
        try:
            sent = await self._send(message)
            self._recent_sends.append(time.time())
            self._log_notification(job_id, level.value, len(message), sent)
            if sent:
                logger.info(f"Sent notification for {job_id} ({level.value}, {len(message)} chars)")
            return sent
        except Exception as e:
            logger.error(f"Failed to send notification for {job_id}: {e}")
            self._log_notification(job_id, level.value, len(message), False)
            return False
