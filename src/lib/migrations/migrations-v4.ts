import type Database from 'better-sqlite3'
import type { Migration } from './migrations-v1'

// Migrations 045–049: 10-feature innovation batch (Chains, Replay, Providers, VectorSearch, Leaderboard)
export const migrations: Migration[] = [
  {
    id: '045_handoff_chains',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS handoff_chains (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'draft',
          created_by TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_handoff_chains_workspace ON handoff_chains(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_handoff_chains_status ON handoff_chains(status)`)
      db.exec(`
        CREATE TABLE IF NOT EXISTS handoff_chain_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chain_id INTEGER NOT NULL REFERENCES handoff_chains(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'running',
          current_step INTEGER NOT NULL DEFAULT 0,
          input_data TEXT,
          output_data TEXT,
          error TEXT,
          started_at INTEGER NOT NULL DEFAULT (unixepoch()),
          completed_at INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chain_runs_chain_id ON handoff_chain_runs(chain_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chain_runs_status ON handoff_chain_runs(status)`)
    }
  },
  {
    id: '046_execution_replay',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS replay_bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          trace_id INTEGER NOT NULL,
          step_index INTEGER NOT NULL,
          label TEXT,
          note TEXT,
          created_by TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_replay_bookmarks_task ON replay_bookmarks(task_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_replay_bookmarks_workspace ON replay_bookmarks(workspace_id)`)
    }
  },
  {
    id: '047_provider_failover',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_routing_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          max_retries INTEGER NOT NULL DEFAULT 2,
          timeout_ms INTEGER NOT NULL DEFAULT 30000,
          capability_tags TEXT DEFAULT '[]',
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(provider, workspace_id)
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_routing_workspace ON provider_routing_rules(workspace_id)`)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_health_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          latency_ms INTEGER,
          status TEXT NOT NULL,
          error TEXT,
          checked_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_health_provider ON provider_health_log(provider)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_health_checked_at ON provider_health_log(checked_at)`)
    }
  },
  {
    id: '048_vector_search',
    up(db: Database.Database) {
      // Gracefully skip if sqlite-vec extension is not loaded
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
            embedding float[1536]
          )
        `)
      } catch {
        // sqlite-vec not available — vector search will fall back to keyword search
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_metadata (
          rowid INTEGER PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_id INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_meta_source ON embedding_metadata(source_type, source_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_meta_workspace ON embedding_metadata(workspace_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_meta_hash ON embedding_metadata(content_hash)`)
    }
  },
  {
    id: '049_leaderboard_cache',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          period TEXT NOT NULL,
          composite_score REAL NOT NULL,
          task_completion_rate REAL,
          avg_response_ms REAL,
          cost_efficiency REAL,
          quality_score REAL,
          error_rate REAL,
          tasks_completed INTEGER DEFAULT 0,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          snapshot_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_agent ON leaderboard_snapshots(agent_name)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_period ON leaderboard_snapshots(period, snapshot_at)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_workspace ON leaderboard_snapshots(workspace_id)`)
    }
  },
]
