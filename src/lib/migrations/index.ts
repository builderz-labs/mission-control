import type Database from 'better-sqlite3'
import type { Migration } from './migrations-v1'
import { migrations as v1Migrations } from './migrations-v1'
import { migrations as v2Migrations } from './migrations-v2'
import { migrations as v3Migrations } from './migrations-v3'
import { migrations as v4Migrations } from './migrations-v4'
import { migrations as v5Migrations } from './migrations-v5'

export type { Migration }

// Flat ordered array of all built-in migrations
export const migrations: Migration[] = [...v1Migrations, ...v2Migrations, ...v3Migrations, ...v4Migrations, ...v5Migrations]

// Plugin hook: extensions can register additional migrations without modifying this file.
const extraMigrations: Migration[] = []

export function registerMigrations(newMigrations: Migration[]): void {
  extraMigrations.push(...newMigrations)
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => (row as { id: string }).id)
  )

  for (const migration of [...migrations, ...extraMigrations]) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(migration.id)
    })()
  }
}
