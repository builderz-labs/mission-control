import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { renameClaudeFleetAgentRows } from '@/lib/claude-fleet-rename'

describe('renameClaudeFleetAgentRows', () => {
  it('renames 20x/5x rows onto claude-1/claude-2 and reassigns tasks', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_id INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        config TEXT
      );
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, assigned_to TEXT);
      CREATE TABLE project_agent_assignments (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        agent_name TEXT NOT NULL,
        UNIQUE(project_id, agent_name)
      );
      INSERT INTO agents (id, name, workspace_id, hidden, config) VALUES
        (1, 'claude-20x', 1, 0, '{"openclawId":"claude-20x","identity":{"name":"claude-20x"}}'),
        (2, 'claude-5x', 1, 0, '{"openclawId":"claude-5x","identity":{"name":"claude-5x"}}');
      INSERT INTO tasks (id, assigned_to) VALUES (1, 'claude-20x');
      INSERT INTO project_agent_assignments (id, project_id, agent_name) VALUES
        (1, 9, 'claude-20x'), (2, 9, 'claude-5x');
    `)
    renameClaudeFleetAgentRows(db)
    const names = db.prepare('SELECT name FROM agents ORDER BY id').all() as Array<{ name: string }>
    expect(names.map((row) => row.name)).toEqual(['claude-1', 'claude-2'])
  })

  it('reveals the canonical row when both old and new names exist', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_id INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        config TEXT
      );
      INSERT INTO agents (id, name, workspace_id, hidden, config) VALUES
        (1, 'claude-20x', 1, 0, '{}'),
        (2, 'claude-1', 1, 1, '{}'),
        (3, 'claude-5x', 1, 0, '{}'),
        (4, 'claude-2', 1, 1, '{}');
    `)
    renameClaudeFleetAgentRows(db)
    const rows = db.prepare('SELECT name, hidden FROM agents ORDER BY id').all() as Array<{
      name: string
      hidden: number
    }>
    expect(rows).toEqual([
      { name: 'claude-20x', hidden: 1 },
      { name: 'claude-1', hidden: 0 },
      { name: 'claude-5x', hidden: 1 },
      { name: 'claude-2', hidden: 0 },
    ])
  })
})
