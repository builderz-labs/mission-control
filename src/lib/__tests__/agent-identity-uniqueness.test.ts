import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare("INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (2, 'two', 'Two', 1)").run()
})

afterEach(() => db.close())

describe('migration 054_agent_name_workspace_unique', () => {
  it('allows the same agent name in separate workspaces', () => {
    db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES ('builder', 'agent', 1)").run()
    expect(() => {
      db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES ('builder', 'agent', 2)").run()
    }).not.toThrow()
  })

  it('still rejects duplicate names inside one workspace', () => {
    db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES ('builder', 'agent', 2)").run()
    expect(() => {
      db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES ('builder', 'agent', 2)").run()
    }).toThrow(/UNIQUE constraint failed: agents.name, agents.workspace_id/)
  })

  it('keeps external session keys globally unique', () => {
    db.prepare("INSERT INTO agents (name, role, session_key, workspace_id) VALUES ('one', 'agent', 'shared-session', 1)").run()
    expect(() => {
      db.prepare("INSERT INTO agents (name, role, session_key, workspace_id) VALUES ('two', 'agent', 'shared-session', 2)").run()
    }).toThrow(/UNIQUE constraint failed: agents.session_key/)
  })

  it('preserves agent ids and foreign-key children across a migration replay', () => {
    const agent = db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES ('key-owner', 'agent', 1)").run()
    db.prepare("INSERT INTO direct_connections (agent_id, tool_name, connection_id) VALUES (?, 'tool', 'connection')").run(agent.lastInsertRowid)
    db.prepare("DELETE FROM schema_migrations WHERE id = '054_agent_name_workspace_unique'").run()
    runMigrations(db)

    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.prepare('SELECT agent_id FROM direct_connections WHERE connection_id = ?').get('connection')).toEqual({ agent_id: agent.lastInsertRowid })

    const foreignKeys = db.pragma("foreign_key_list('direct_connections')") as Array<{ table: string }>
    expect(foreignKeys.map((foreignKey) => foreignKey.table)).toContain('agents')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.prepare("SELECT id FROM schema_migrations WHERE id = '054_agent_name_workspace_unique'").get()).toBeDefined()
  })
})
