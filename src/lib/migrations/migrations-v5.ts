import type Database from 'better-sqlite3'
import type { Migration } from './migrations-v1'

// Migrations 050–055: Council deliberations, trajectory comparisons, browser sessions, governance gates, indexes
export const migrations: Migration[] = [
  {
    id: '050_council_deliberations',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS council_deliberations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          workspace_id INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'open',
          round INTEGER NOT NULL DEFAULT 1,
          synthesis TEXT,
          started_at INTEGER NOT NULL DEFAULT (unixepoch()),
          completed_at INTEGER
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_council_workspace ON council_deliberations(workspace_id, status)`)
      db.exec(`
        CREATE TABLE IF NOT EXISTS council_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          deliberation_id INTEGER NOT NULL REFERENCES council_deliberations(id),
          agent_id TEXT NOT NULL,
          round INTEGER NOT NULL DEFAULT 1,
          position TEXT NOT NULL,
          stance TEXT NOT NULL DEFAULT 'neutral',
          confidence REAL NOT NULL DEFAULT 0.5,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_deliberation ON council_votes(deliberation_id, round)`)
    }
  },
  {
    id: '051_trajectory_comparisons',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trajectory_comparisons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_name TEXT NOT NULL,
          config_a TEXT NOT NULL DEFAULT '{}',
          config_b TEXT NOT NULL DEFAULT '{}',
          metric_name TEXT NOT NULL,
          value_a REAL,
          value_b REAL,
          winner TEXT,
          confidence REAL DEFAULT 0,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          resolved_at INTEGER
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_traj_operation ON trajectory_comparisons(operation_name, workspace_id)`)
    }
  },
  {
    id: '052_browse_sessions',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS browse_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          result TEXT,
          screenshot_path TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          started_at INTEGER NOT NULL DEFAULT (unixepoch()),
          completed_at INTEGER
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_browse_agent ON browse_sessions(agent_id, workspace_id)`)
    }
  },
  {
    id: '053_governance_gates',
    up(db: Database.Database) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS governance_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          gate_type TEXT NOT NULL,
          dimension TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 0.2,
          threshold REAL NOT NULL DEFAULT 0.7,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`
        CREATE TABLE IF NOT EXISTS governance_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER,
          gate_type TEXT NOT NULL,
          total_score REAL NOT NULL,
          passed INTEGER NOT NULL DEFAULT 0,
          scores TEXT NOT NULL DEFAULT '{}',
          override_by TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          evaluated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_gov_task ON governance_results(task_id, workspace_id)`)
    }
  },
  {
    id: '054_governance_and_index_fixes',
    up(db: Database.Database) {
      // WHY: governance_rules needs UNIQUE(gate_type, dimension, workspace_id) so that
      // the upsert ON CONFLICT clause in gate.ts has a target column group to resolve on.
      // Without this, every upsertRule call silently inserts a duplicate row instead of updating.
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_rules_uq
        ON governance_rules(gate_type, dimension, workspace_id)
      `)
      // WHY: council_votes.workspace_id is used in WHERE clauses in engine.ts to
      // scope votes to a workspace but had no supporting index — adds one now.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_council_votes_workspace
        ON council_votes(workspace_id)
      `)
      // WHY: browse_sessions.status is used in status-based polling queries and
      // cleanup jobs — index reduces full-table scans on large session logs.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_browse_sessions_status
        ON browse_sessions(status)
      `)
    }
  },
  {
    id: '055_council_vote_unique_and_gov_workspace_index',
    up(db: Database.Database) {
      // WHY: prevents the same agent from casting duplicate votes in a single round,
      // which would skew weighted consensus calculations
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_council_votes_unique
        ON council_votes(deliberation_id, agent_id, round, workspace_id)
      `)
      // WHY: listResults() filters by workspace_id ORDER BY evaluated_at DESC —
      // without this index it performs a full-table scan as the results table grows
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_gov_results_workspace
        ON governance_results(workspace_id, evaluated_at DESC)
      `)
    }
  },
]
