import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { seedRepoHealthTasks } from '@/lib/repo-health-tasks'

describe('repo health tasks', () => {
  it('upserts a repo-health task for a git checkout', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-repo-health-'))
    execFileSync('git', ['init'], { cwd: root })
    writeFileSync(path.join(root, 'README.md'), 'ok\n')
    execFileSync('git', ['add', 'README.md'], { cwd: root })
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-m', 'init'], { cwd: root })
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, workspace_id INTEGER, slug TEXT);
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, description TEXT, status TEXT, priority TEXT,
        assigned_to TEXT, created_by TEXT, created_at INTEGER, updated_at INTEGER,
        workspace_id INTEGER, project_id INTEGER, metadata TEXT
      );
    `)
    db.prepare('INSERT INTO projects (id, workspace_id, slug) VALUES (1, 1, ? )').run('tmp-health')
    const result = seedRepoHealthTasks(db, 1, [{
      name: 'tmp-health',
      slug: 'tmp-health',
      ticketPrefix: 'TMP',
      path: root,
      githubRepo: null,
    }])
    expect(result.upserted).toBe(1)
    const row = db.prepare('SELECT title, status FROM tasks').get() as { title: string; status: string }
    expect(row.title).toBe('Repo health: tmp-health')
    expect(['inbox', 'done']).toContain(row.status)
  })
})
