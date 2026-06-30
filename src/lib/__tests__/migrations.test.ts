import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'

// Regression guard for schema.sql-vs-migration drift.
//
// A from-scratch `runMigrations` once failed at `053_agent_briefings` with
// `SqliteError: no such column: workspace_id`: schema.sql (run by `001_init`)
// created the `briefings` table WITHOUT `workspace_id`, so migration 053's
// `CREATE TABLE IF NOT EXISTS briefings (...)` was a no-op and the column its
// index needed never appeared. Production predated schema.sql gaining that
// table, so the bug was invisible until a clean install. Fixed in 12fa971.
//
// These tests exercise a brand-new in-memory DB so any future drift between
// schema.sql and the later migrations fails loudly here instead of in prod.

describe('runMigrations on a fresh database', () => {
  let db: Database.Database

  afterEach(() => {
    db?.close()
  })

  it('runs the full migration chain clean on a brand-new DB', () => {
    db = new Database(':memory:')
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('is idempotent — a second run is a no-op and does not throw', () => {
    db = new Database(':memory:')
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('adds workspace_id to the briefings table (the original drift bug)', () => {
    db = new Database(':memory:')
    runMigrations(db)

    const columns = db
      .prepare(`PRAGMA table_info(briefings)`)
      .all() as Array<{ name: string }>
    const names = columns.map((c) => c.name)

    expect(names).toContain('workspace_id')
  })

  it('every workspace_id index points at a table that actually has the column', () => {
    // Generic drift catcher: if a later migration adds an index on
    // `workspace_id` but the table (created earlier by schema.sql) lacks the
    // column, this surfaces it — the exact shape of the briefings regression.
    db = new Database(':memory:')
    runMigrations(db)

    const indexes = db
      .prepare(
        `SELECT name, tbl_name, sql FROM sqlite_master
         WHERE type = 'index' AND sql LIKE '%workspace_id%'`
      )
      .all() as Array<{ name: string; tbl_name: string; sql: string }>

    // Sanity: the fixture should include at least the briefings indexes.
    expect(indexes.length).toBeGreaterThan(0)

    for (const idx of indexes) {
      const columns = db
        .prepare(`PRAGMA table_info(${idx.tbl_name})`)
        .all() as Array<{ name: string }>
      const names = columns.map((c) => c.name)
      expect(
        names,
        `index ${idx.name} references workspace_id but table ${idx.tbl_name} lacks the column`
      ).toContain('workspace_id')
    }
  })
})
