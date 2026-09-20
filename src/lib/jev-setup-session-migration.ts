import type { Migration } from './migrations'

export const jevSetupSessionMigration: Migration = {
  id: '068_jev_setup_sessions',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jev_setup_sessions (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        created_by_user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft', 'ready', 'archived')),
        primary_policy_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER,
        UNIQUE(workspace_id, id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY(primary_policy_id) REFERENCES jev_policies(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jev_setup_sessions_project
        ON jev_setup_sessions(workspace_id, project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jev_setup_sessions_creator
        ON jev_setup_sessions(created_by_user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS jev_setup_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal > 0),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete', 'error')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(session_id, ordinal),
        FOREIGN KEY(workspace_id, session_id)
          REFERENCES jev_setup_sessions(workspace_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_jev_setup_messages_order
        ON jev_setup_messages(workspace_id, session_id, ordinal);

      CREATE TABLE IF NOT EXISTS jev_setup_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        revision_no INTEGER NOT NULL CHECK(revision_no > 0),
        draft TEXT NOT NULL,
        configuration TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'validated'
          CHECK(status IN ('validated', 'applied')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(session_id, revision_no),
        FOREIGN KEY(workspace_id, session_id)
          REFERENCES jev_setup_sessions(workspace_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_jev_setup_revisions_order
        ON jev_setup_revisions(workspace_id, session_id, revision_no DESC);

      CREATE TABLE IF NOT EXISTS jev_setup_revision_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        revision_id INTEGER NOT NULL,
        policy_id INTEGER,
        project_id INTEGER NOT NULL,
        policy_name TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(revision_id,project_id),
        FOREIGN KEY(workspace_id,session_id)
          REFERENCES jev_setup_sessions(workspace_id,id) ON DELETE CASCADE,
        FOREIGN KEY(revision_id) REFERENCES jev_setup_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY(policy_id) REFERENCES jev_policies(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jev_setup_revision_policies_session
        ON jev_setup_revision_policies(workspace_id,session_id,created_at DESC);
    `)
  },
}
