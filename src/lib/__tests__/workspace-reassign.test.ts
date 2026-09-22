import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { reassignWorkspaceRows } from '@/lib/workspace-reassign'

describe('reassignWorkspaceRows', () => {
  it('moves every workspace-scoped table, including tasks, before the workspace is gone', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE workspaces (id INTEGER PRIMARY KEY, slug TEXT);
      CREATE TABLE agents (id INTEGER PRIMARY KEY, workspace_id INTEGER, updated_at INTEGER);
      CREATE TABLE users (id INTEGER PRIMARY KEY, workspace_id INTEGER, updated_at INTEGER);
      CREATE TABLE projects (id INTEGER PRIMARY KEY, workspace_id INTEGER, updated_at INTEGER);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, workspace_id INTEGER, updated_at INTEGER);
      CREATE TABLE comments (id INTEGER PRIMARY KEY, workspace_id INTEGER);
      INSERT INTO workspaces VALUES (1, 'default'), (2, 'gone');
      INSERT INTO agents VALUES (1, 2, 0);
      INSERT INTO users VALUES (1, 2, 0);
      INSERT INTO projects VALUES (1, 2, 0);
      INSERT INTO tasks VALUES (1, 2, 0);
      INSERT INTO comments VALUES (1, 2);
    `)

    const moved = reassignWorkspaceRows(db, 2, 1, 99)
    expect(moved).toBe(5)
    expect(db.prepare('SELECT workspace_id, updated_at FROM tasks WHERE id = 1').get()).toEqual({
      workspace_id: 1,
      updated_at: 99,
    })
    expect(db.prepare('SELECT workspace_id FROM comments WHERE id = 1').get()).toEqual({ workspace_id: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id = 2').get()).toEqual({ n: 1 })
    db.close()
  })
})
