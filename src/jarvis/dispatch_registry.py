"""
JARVIS Dispatch Registry — tracks all active and recent project builds/dispatches.

Persists to SQLite so JARVIS always knows what he's working on,
what just finished, and what the user is likely referring to.
"""

import logging
import sqlite3
import time
from pathlib import Path

log = logging.getLogger("jarvis.dispatch")

DB_PATH = Path(__file__).parent / "data" / "jarvis.db"


def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_dispatch_db():
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name TEXT NOT NULL,
            project_path TEXT NOT NULL,
            original_prompt TEXT NOT NULL,
            refined_prompt TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            claude_response TEXT DEFAULT '',
            summary TEXT DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            completed_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatches(status);
        CREATE INDEX IF NOT EXISTS idx_dispatch_updated ON dispatches(updated_at DESC);
    """)
    conn.close()


class DispatchRegistry:
    def __init__(self):
        init_dispatch_db()

    def register(self, project_name: str, project_path: str, prompt: str) -> int:
        """Register a new dispatch. Returns dispatch ID."""
        conn = _get_db()
        now = time.time()
        cur = conn.execute(
            "INSERT INTO dispatches (project_name, project_path, original_prompt, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'pending', ?, ?)",
            (project_name, project_path, prompt, now, now)
        )
        dispatch_id = cur.lastrowid
        conn.commit()
        conn.close()
        log.info(f"Registered dispatch #{dispatch_id}: {project_name}")
        return dispatch_id

    def update_status(self, dispatch_id: int, status: str,
                      response: str = None, summary: str = None):
        """Update dispatch status and optionally store response/summary."""
        conn = _get_db()
        now = time.time()
        if response is not None:
            conn.execute(
                "UPDATE dispatches SET status=?, claude_response=?, summary=?, updated_at=?, "
                "completed_at=? WHERE id=?",
                (status, response[:5000], summary or "", now,
                 now if status in ("completed", "failed", "timeout") else None,
                 dispatch_id)
            )
        else:
            conn.execute(
                "UPDATE dispatches SET status=?, updated_at=? WHERE id=?",
                (status, now, dispatch_id)
            )
        conn.commit()
        conn.close()

    def get_most_recent(self) -> dict | None:
        """Get the most recently updated dispatch."""
        conn = _get_db()
        row = conn.execute(
            "SELECT * FROM dispatches ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def get_active(self) -> list[dict]:
        """Get all pending/building dispatches."""
        conn = _get_db()
        rows = conn.execute(
            "SELECT * FROM dispatches WHERE status IN ('pending','building','planning') "
            "ORDER BY updated_at DESC"
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_by_name(self, name: str) -> dict | None:
        """Fuzzy match dispatch by project name."""
        conn = _get_db()
        row = conn.execute(
            "SELECT * FROM dispatches WHERE project_name LIKE ? ORDER BY updated_at DESC LIMIT 1",
            (f"%{name}%",)
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def get_recent(self, limit: int = 5) -> list[dict]:
        """Get last N dispatches."""
        conn = _get_db()
        rows = conn.execute(
            "SELECT * FROM dispatches ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def format_for_prompt(self) -> str:
        """Format active + recent dispatches as context for the LLM."""
        active = self.get_active()
        recent = self.get_recent(3)

        parts = []

        if active:
            lines = []
            for d in active:
                elapsed = int(time.time() - d["created_at"])
                lines.append(f"  - [{d['status']}] {d['project_name']} ({elapsed}s ago): {d['original_prompt'][:80]}")
            parts.append("CURRENTLY WORKING ON:\n" + "\n".join(lines))

        completed = [d for d in recent if d["status"] == "completed" and d not in active]
        if completed:
            lines = []
            for d in completed[:2]:
                lines.append(f"  - {d['project_name']}: {d['summary'][:80]}" if d["summary"] else f"  - {d['project_name']}: completed")
            parts.append("RECENTLY COMPLETED:\n" + "\n".join(lines))

        return "\n".join(parts) if parts else "No active or recent dispatches."
