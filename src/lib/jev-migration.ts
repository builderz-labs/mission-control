import type { Migration } from './migrations'

export const jevMigration: Migration = {
  id: '064_jev_repository_evaluations',
  up(db) {
    db.exec(`
      CREATE TABLE jev_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        model TEXT NOT NULL DEFAULT 'jev-latest',
        mode TEXT NOT NULL DEFAULT 'shadow' CHECK(mode IN ('manual', 'shadow')),
        questions TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(workspace_id, project_id, name),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_jev_policies_project ON jev_policies(workspace_id, project_id, updated_at DESC);

      CREATE TABLE jev_evaluations (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        policy_id INTEGER,
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        model_requested TEXT NOT NULL,
        model_resolved TEXT,
        questions TEXT NOT NULL,
        answers TEXT,
        usage_input_tokens INTEGER,
        usage_output_tokens INTEGER,
        latency_ms INTEGER,
        request_id TEXT,
        state_sha256 TEXT NOT NULL,
        state_length INTEGER NOT NULL,
        state_preview TEXT,
        error_code TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(policy_id) REFERENCES jev_policies(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_jev_evaluations_project ON jev_evaluations(workspace_id, project_id, created_at DESC);
      CREATE INDEX idx_jev_evaluations_policy ON jev_evaluations(policy_id, created_at DESC);
    `)
  },
}
