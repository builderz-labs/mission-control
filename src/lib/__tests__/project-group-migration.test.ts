// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => db.close())

describe('migration 056_project_groups', () => {
  it('adds a nullable group and its workspace index', () => {
    const columns = db.pragma('table_info(projects)') as Array<{ name: string; notnull: number }>
    expect(columns.find((column) => column.name === 'group_name')).toMatchObject({ notnull: 0 })

    const indexes = db.pragma('index_list(projects)') as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('idx_projects_workspace_group')
  })

  it('can be replayed without losing project groups', () => {
    db.prepare("UPDATE projects SET group_name = 'InHaus' WHERE slug = 'general'").run()
    db.prepare("DELETE FROM schema_migrations WHERE id = '056_project_groups'").run()

    expect(() => runMigrations(db)).not.toThrow()
    expect(db.prepare("SELECT group_name FROM projects WHERE slug = 'general'").get()).toEqual({ group_name: 'InHaus' })
  })
})
