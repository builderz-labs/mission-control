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
