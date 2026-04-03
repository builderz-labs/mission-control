"""
JARVIS Usage Learning — Tracks request patterns and pre-loads context.

Identifies what tasks the user requests most, which projects are active,
and suggests relevant context based on patterns.
"""

import logging
import sqlite3
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

log = logging.getLogger("jarvis.learning")

DB_PATH = Path(__file__).parent / "jarvis_data.db"


@dataclass
class ContextSuggestion:
    suggestion_text: str  # Voice-friendly suggestion
    project_dir: str  # Suggested project directory
    confidence: float  # 0.0 to 1.0

    def to_dict(self) -> dict:
        return asdict(self)


class UsageLearner:
    """Tracks usage patterns and suggests context based on history."""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(DB_PATH)
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._ensure_tables()

    def _ensure_tables(self):
        """Ensure required tables exist (created by tracking.py, but be safe)."""
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
        """)
        self.db.commit()

    def get_frequent_types(self, days: int = 30) -> list[tuple[str, int]]:
        """Get task type frequency over the specified period."""
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        try:
            rows = self.db.execute(
                "SELECT task_type, COUNT(*) as cnt FROM task_log "
                "WHERE created_at > ? GROUP BY task_type ORDER BY cnt DESC",
                (cutoff,),
            ).fetchall()
            return [(row["task_type"], row["cnt"]) for row in rows]
        except Exception as e:
            log.warning(f"Failed to get frequent types: {e}")
            return []

    def get_recent_projects(self, days: int = 7) -> list[str]:
        """Get unique project directories from recent usage patterns."""
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        try:
            rows = self.db.execute(
                "SELECT DISTINCT keyword FROM usage_patterns "
                "WHERE keyword != '' AND last_used > ? ORDER BY last_used DESC",
                (cutoff,),
            ).fetchall()
            return [row["keyword"] for row in rows]
        except Exception as e:
            log.warning(f"Failed to get recent projects: {e}")
            return []

    def suggest_context(
        self,
        user_text: str,
        known_projects: list[dict] = None,
    ) -> Optional[ContextSuggestion]:
        """Suggest relevant context based on user text and recent patterns.

        Returns a ContextSuggestion if confidence is high enough, None otherwise.
        """
        if not known_projects:
            return None

        user_lower = user_text.lower()
        best_match = None
        best_confidence = 0.0

        for project in known_projects:
            project_name = project["name"].lower()
            project_path = project.get("path", "")

            # Direct name mention
            if project_name in user_lower:
                return ContextSuggestion(
                    suggestion_text=f"I'll use the {project['name']} project directory, sir.",
                    project_dir=project_path,
                    confidence=0.95,
                )

            # Fuzzy match — check if project name words appear in the text
            name_words = project_name.replace("-", " ").replace("_", " ").split()
            matches = sum(1 for w in name_words if w in user_lower and len(w) > 2)
            if name_words and matches > 0:
                confidence = matches / len(name_words) * 0.8
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match = project

        # Check recency boost — recent projects get higher confidence
        recent_projects = self.get_recent_projects(days=3)
        if best_match and best_match.get("path", "") in recent_projects:
            best_confidence = min(best_confidence + 0.15, 1.0)

        if best_match and best_confidence >= 0.7:
            return ContextSuggestion(
                suggestion_text=(
                    f"Based on your recent work, shall I use the {best_match['name']} "
                    f"project directory, sir?"
                ),
                project_dir=best_match.get("path", ""),
                confidence=best_confidence,
            )

        # Check for tech stack patterns
        frequent_types = self.get_frequent_types(days=14)
        if frequent_types:
            top_type, top_count = frequent_types[0]
            if top_count >= 3:
                # User has a pattern
                type_words = {
                    "build": "building",
                    "fix": "fixing",
                    "refactor": "refactoring",
                    "research": "researching",
                }
                action_word = type_words.get(top_type, top_type)
                # Only suggest if relevant to current request
                if any(kw in user_lower for kw in [top_type, action_word]):
                    return ContextSuggestion(
                        suggestion_text=(
                            f"You've been doing quite a bit of {action_word} lately, sir. "
                            f"Shall I apply the same approach here?"
                        ),
                        project_dir="",
                        confidence=0.6,  # Lower confidence — informational only
                    )

        return None

    def get_session_stats(self) -> dict:
        """Get overall usage statistics for the current session summary."""
        try:
            total = self.db.execute("SELECT COUNT(*) as cnt FROM task_log").fetchone()["cnt"]
            success = self.db.execute(
                "SELECT COUNT(*) as cnt FROM task_log WHERE success = 1"
            ).fetchone()["cnt"]
            recent = self.db.execute(
                "SELECT COUNT(*) as cnt FROM task_log WHERE created_at > ?",
                ((datetime.now() - timedelta(days=7)).isoformat(),),
            ).fetchone()["cnt"]

            return {
                "total_tasks": total,
                "success_rate": (success / total * 100) if total > 0 else 0.0,
                "tasks_this_week": recent,
            }
        except Exception as e:
            log.warning(f"Failed to get session stats: {e}")
            return {"total_tasks": 0, "success_rate": 0.0, "tasks_this_week": 0}

    def close(self):
        try:
            self.db.close()
        except Exception:
            pass
