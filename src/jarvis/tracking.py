"""
JARVIS Success Tracker — Track task success rates and usage patterns.

Stores metrics in SQLite for analysis and learning.
"""

import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger("jarvis.tracking")

DB_PATH = Path(__file__).parent / "jarvis_data.db"


class SuccessTracker:
    """Track task success rates and usage patterns."""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(DB_PATH)
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS task_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT NOT NULL,
                prompt TEXT NOT NULL,
                success INTEGER NOT NULL,
                retry_count INTEGER DEFAULT 0,
                duration_seconds REAL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usage_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                keyword TEXT,
                count INTEGER DEFAULT 1,
                last_used TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                suggestion TEXT NOT NULL,
                accepted INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_task_log_type ON task_log(task_type);
            CREATE INDEX IF NOT EXISTS idx_usage_action ON usage_patterns(action_type);
        """)
        self.db.commit()

    def log_task(
        self,
        task_type: str,
        prompt: str,
        success: bool,
        retry_count: int = 0,
        duration: float = 0.0,
    ):
        """Log a completed task."""
        try:
            self.db.execute(
                "INSERT INTO task_log (task_type, prompt, success, retry_count, duration_seconds, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (task_type, prompt[:500], int(success), retry_count, duration, datetime.now().isoformat()),
            )
            self.db.commit()
            log.info(f"Logged task: type={task_type}, success={success}, retries={retry_count}")
        except Exception as e:
            log.warning(f"Failed to log task: {e}")

    def log_usage(self, action_type: str, keyword: str = ""):
        """Track usage patterns — what types of requests are made most."""
        try:
            existing = self.db.execute(
                "SELECT id, count FROM usage_patterns WHERE action_type = ? AND keyword = ?",
                (action_type, keyword),
            ).fetchone()

            if existing:
                self.db.execute(
                    "UPDATE usage_patterns SET count = count + 1, last_used = ? WHERE id = ?",
                    (datetime.now().isoformat(), existing["id"]),
                )
            else:
                self.db.execute(
                    "INSERT INTO usage_patterns (action_type, keyword, count, last_used) VALUES (?, ?, 1, ?)",
                    (action_type, keyword, datetime.now().isoformat()),
                )
            self.db.commit()
        except Exception as e:
            log.warning(f"Failed to log usage: {e}")

    def log_suggestion(self, task_id: str, suggestion: str):
        """Log a proactive suggestion."""
        try:
            self.db.execute(
                "INSERT INTO suggestions (task_id, suggestion, created_at) VALUES (?, ?, ?)",
                (task_id, suggestion, datetime.now().isoformat()),
            )
            self.db.commit()
        except Exception as e:
            log.warning(f"Failed to log suggestion: {e}")

    def mark_suggestion_accepted(self, suggestion_id: int):
        """Mark a suggestion as accepted by the user."""
        try:
            self.db.execute(
                "UPDATE suggestions SET accepted = 1 WHERE id = ?",
                (suggestion_id,),
            )
            self.db.commit()
        except Exception as e:
            log.warning(f"Failed to mark suggestion: {e}")

    def get_success_rate(self, task_type: str = None) -> dict:
        """Get success rate stats, optionally filtered by task type."""
        try:
            if task_type:
                rows = self.db.execute(
                    "SELECT success, COUNT(*) as cnt FROM task_log WHERE task_type = ? GROUP BY success",
                    (task_type,),
                ).fetchall()
            else:
                rows = self.db.execute(
                    "SELECT success, COUNT(*) as cnt FROM task_log GROUP BY success",
                ).fetchall()

            total = sum(r["cnt"] for r in rows)
            passed = sum(r["cnt"] for r in rows if r["success"])

            return {
                "total": total,
                "passed": passed,
                "failed": total - passed,
                "rate": (passed / total * 100) if total > 0 else 0.0,
            }
        except Exception as e:
            log.warning(f"Failed to get success rate: {e}")
            return {"total": 0, "passed": 0, "failed": 0, "rate": 0.0}

    def get_top_actions(self, limit: int = 10) -> list[dict]:
        """Get the most common action types."""
        try:
            rows = self.db.execute(
                "SELECT action_type, keyword, count, last_used FROM usage_patterns "
                "ORDER BY count DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            log.warning(f"Failed to get top actions: {e}")
            return []

    def get_avg_duration(self, task_type: str = None) -> float:
        """Get average task duration in seconds."""
        try:
            if task_type:
                row = self.db.execute(
                    "SELECT AVG(duration_seconds) as avg_dur FROM task_log WHERE task_type = ?",
                    (task_type,),
                ).fetchone()
            else:
                row = self.db.execute(
                    "SELECT AVG(duration_seconds) as avg_dur FROM task_log",
                ).fetchone()
            return row["avg_dur"] or 0.0
        except Exception as e:
            log.warning(f"Failed to get avg duration: {e}")
            return 0.0

    def close(self):
        """Close the database connection."""
        try:
            self.db.close()
        except Exception:
            pass
