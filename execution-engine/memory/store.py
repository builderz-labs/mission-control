"""RoceOS Knowledge Store — persistent per-skillset memory.

Simple SQLite-backed key-value store where skillsets can remember
facts from conversations and recall them later. Namespaced per skillset.

Example:
    store = KnowledgeStore("/app/data/knowledge.db")
    store.remember("wealth", "Ross started 401k contributions on 2026-04-20")
    facts = store.recall("wealth", "401k")
"""
import json
import logging
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger("roceos.memory")


class KnowledgeStore:
    """Per-skillset knowledge storage backed by SQLite."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS knowledge (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    skillset TEXT NOT NULL,
                    fact TEXT NOT NULL,
                    tags TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    source TEXT DEFAULT 'conversation'
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_knowledge_skillset
                ON knowledge(skillset)
            """)
            conn.commit()

    def remember(self, skillset: str, fact: str, tags: str = "", source: str = "conversation"):
        """Store a fact for a skillset."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO knowledge (skillset, fact, tags, created_at, source) VALUES (?, ?, ?, ?, ?)",
                (skillset, fact, tags, time.time(), source),
            )
            conn.commit()
        logger.info(f"[{skillset}] Remembered: {fact[:80]}...")

    def recall(self, skillset: str, query: str = "", limit: int = 20) -> list[dict]:
        """Recall facts for a skillset, optionally filtered by search query."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            if query:
                rows = conn.execute(
                    "SELECT * FROM knowledge WHERE skillset = ? AND (fact LIKE ? OR tags LIKE ?) ORDER BY created_at DESC LIMIT ?",
                    (skillset, f"%{query}%", f"%{query}%", limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM knowledge WHERE skillset = ? ORDER BY created_at DESC LIMIT ?",
                    (skillset, limit),
                ).fetchall()

        return [dict(row) for row in rows]

    def recall_all(self, query: str = "", limit: int = 50) -> list[dict]:
        """Recall facts across all skillsets."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            if query:
                rows = conn.execute(
                    "SELECT * FROM knowledge WHERE fact LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?",
                    (f"%{query}%", f"%{query}%", limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()

        return [dict(row) for row in rows]

    def forget(self, fact_id: int):
        """Remove a specific fact."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM knowledge WHERE id = ?", (fact_id,))
            conn.commit()

    def count(self, skillset: str = "") -> int:
        """Count facts, optionally filtered by skillset."""
        with sqlite3.connect(self.db_path) as conn:
            if skillset:
                return conn.execute(
                    "SELECT COUNT(*) FROM knowledge WHERE skillset = ?", (skillset,)
                ).fetchone()[0]
            return conn.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
