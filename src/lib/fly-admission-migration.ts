import type { Migration } from './migrations'

export const flyAdmissionMigration: Migration = {
  id: '061_fly_durable_admission',
  up(db) {
    db.exec(`
      CREATE TABLE fly_submissions (
        id TEXT PRIMARY KEY, workspace_id INTEGER NOT NULL, request_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL, payload TEXT NOT NULL, task_id INTEGER NOT NULL UNIQUE,
        state TEXT NOT NULL DEFAULT 'queued', reason TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        session_id TEXT, swarm_id TEXT, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(workspace_id, request_key),
        FOREIGN KEY(task_id) REFERENCES tasks(id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
      );
      ALTER TABLE fly_worker_jobs ADD COLUMN submission_id TEXT REFERENCES fly_submissions(id);
      ALTER TABLE fly_worker_jobs ADD COLUMN hourly_rate_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE fly_worker_jobs ADD COLUMN outcome_json TEXT;
      ALTER TABLE fly_worker_jobs ADD COLUMN cleanup_completed_at INTEGER;
      ALTER TABLE fly_worker_jobs ADD COLUMN launch_name TEXT;
      ALTER TABLE fly_worker_jobs ADD COLUMN transport TEXT NOT NULL DEFAULT 'callback';
      CREATE UNIQUE INDEX idx_fly_one_active_attempt ON fly_worker_jobs(task_id, workspace_id)
        WHERE state IN ('creating','running','cleaning');
      CREATE INDEX idx_fly_submission_queue ON fly_submissions(state, next_attempt_at, created_at);
      CREATE TABLE fly_scheduler_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires_at INTEGER NOT NULL);
      INSERT INTO fly_scheduler_lock VALUES (1, NULL, 0);
    `)
  },
}
