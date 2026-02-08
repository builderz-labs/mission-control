import { readFileSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'

type Migration = {
  id: string
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    id: '001_init',
    up: (db) => {
      const schemaPath = join(process.cwd(), 'src', 'lib', 'schema.sql')
      const schema = readFileSync(schemaPath, 'utf8')
      const statements = schema.split(';').filter((stmt) => stmt.trim())
      db.transaction(() => {
        for (const statement of statements) {
          db.exec(statement.trim())
        }
      })()
    }
  },
  {
    id: '002_quality_reviews',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quality_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          reviewer TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_task_id ON quality_reviews(task_id);
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_reviewer ON quality_reviews(reviewer);
      `)
    }
  },
  {
    id: '003_quality_review_status_backfill',
    up: (db) => {
      // Convert existing review tasks to quality_review to enforce the gate
      db.exec(`
        UPDATE tasks
        SET status = 'quality_review'
        WHERE status = 'review';
      `)
    }
  },
  {
    id: '004_messages',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          from_agent TEXT NOT NULL,
          to_agent TEXT,
          content TEXT NOT NULL,
          message_type TEXT DEFAULT 'text',
          metadata TEXT,
          read_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_agents ON messages(from_agent, to_agent)
      `)
    }
  },
  {
    id: '005_users',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'operator',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_login_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          ip_address TEXT,
          user_agent TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
      `)
    }
  },
  {
    id: '006_workflow_templates',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          model TEXT NOT NULL DEFAULT 'sonnet',
          task_prompt TEXT NOT NULL,
          timeout_seconds INTEGER NOT NULL DEFAULT 300,
          agent_role TEXT,
          tags TEXT,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_templates_name ON workflow_templates(name);
        CREATE INDEX IF NOT EXISTS idx_workflow_templates_created_by ON workflow_templates(created_by);
      `)
    }
  },
  {
    id: '007_audit_log',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          actor_id INTEGER,
          target_type TEXT,
          target_id INTEGER,
          detail TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
      `)
    }
  },
  {
    id: '008_webhooks',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          secret TEXT,
          events TEXT NOT NULL DEFAULT '["*"]',
          enabled INTEGER NOT NULL DEFAULT 1,
          last_fired_at INTEGER,
          last_status INTEGER,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status_code INTEGER,
          response_body TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
        CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);
      `)
    }
  },
  {
    id: '009_pipelines',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_pipelines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL DEFAULT '[]',
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step INTEGER NOT NULL DEFAULT 0,
          steps_snapshot TEXT NOT NULL DEFAULT '[]',
          started_at INTEGER,
          completed_at INTEGER,
          triggered_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (pipeline_id) REFERENCES workflow_pipelines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_pipelines_name ON workflow_pipelines(name);
      `)
    }
  }
]

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row: any) => row.id)
  )

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id)
    })()
  }
}
