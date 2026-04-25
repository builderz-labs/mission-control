#!/usr/bin/env python3
"""Run all .sql migrations in this directory in lexical order against bot.db.

Each ALTER TABLE ADD COLUMN that fails with 'duplicate column name' is skipped
(makes the migrations idempotent).
"""
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "bot.db"
MIGRATIONS_DIR = Path(__file__).resolve().parent


def run():
    if not DB.exists():
        print(f"ERROR: bot.db not found at {DB}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB)
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No migrations found.")
        return

    for path in files:
        print(f"== {path.name} ==")
        # Strip line comments before splitting on ;
        lines = [ln for ln in path.read_text().splitlines() if not ln.strip().startswith("--")]
        sql = "\n".join(lines)
        for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
            try:
                conn.execute(stmt)
                print(f"  OK: {stmt[:80]}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e):
                    print(f"  SKIP (already applied): {stmt[:80]}")
                else:
                    print(f"  ERROR: {e}")
                    print(f"  Statement: {stmt}")
                    conn.close()
                    sys.exit(2)
    conn.commit()
    conn.close()
    print("Migrations complete.")


if __name__ == "__main__":
    run()
