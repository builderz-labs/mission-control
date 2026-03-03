/**
 * Lionroot-specific database migrations.
 *
 * Numbering starts at 100 to avoid conflicts with upstream migrations (001–099).
 * This file is imported by the patched migrations.ts (see UPSTREAM-PATCHES.md).
 */

import type Database from "better-sqlite3";

type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

export const lionrootMigrations: Migration[] = [
  {
    id: "100_lionroot_init",
    up: (db) => {
      db.exec(`
        -- Guidance file metadata cache (optional — files are canonical on disk)
        CREATE TABLE IF NOT EXISTS lionroot_guidance_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level INTEGER NOT NULL DEFAULT 2,
          scope TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          file_path TEXT NOT NULL UNIQUE,
          summary TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lionroot_guidance_scope
          ON lionroot_guidance_files(scope, scope_id);

        -- Zulip loop state snapshot
        CREATE TABLE IF NOT EXISTS lionroot_loop_state (
          stream_name TEXT PRIMARY KEY,
          agent_id TEXT,
          latest_topic TEXT,
          latest_message_id INTEGER,
          message_count_24h INTEGER DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Observatory session graph edges
        CREATE TABLE IF NOT EXISTS lionroot_session_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_session TEXT NOT NULL,
          target_session TEXT NOT NULL,
          edge_type TEXT NOT NULL DEFAULT 'handoff',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lionroot_session_edges_source
          ON lionroot_session_edges(source_session);
      `);
    },
  },
];
