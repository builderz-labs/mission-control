import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import { API_KEY_HEADER } from './helpers'

const dbPath = resolve('.tmp/e2e-openclaw/local/data/mission-control.db')

test.describe('Workspace isolation boundary', () => {
  test('authenticated routes cannot read, search, update, or delete a foreign task', async ({ request }) => {
    const token = `foreign-workspace-${Date.now()}`
    const db = new Database(dbPath)
    db.pragma('busy_timeout = 5000')

    const workspace = db.prepare(`
      INSERT INTO workspaces (slug, name, tenant_id, isolation, created_at, updated_at)
      VALUES (?, ?, 1, 'strict', unixepoch(), unixepoch())
    `).run(token, 'Foreign E2E Workspace')
    const workspaceId = Number(workspace.lastInsertRowid)
    const task = db.prepare(`
      INSERT INTO tasks (title, description, status, priority, created_by, workspace_id)
      VALUES (?, 'must remain private', 'inbox', 'medium', 'fixture', ?)
    `).run(token, workspaceId)
    const taskId = Number(task.lastInsertRowid)

    try {
      const listRes = await request.get('/api/tasks?limit=200', { headers: API_KEY_HEADER })
      expect(listRes.status()).toBe(200)
      const listBody = await listRes.json()
      expect(listBody.tasks.some((item: { id: number }) => item.id === taskId)).toBe(false)

      const searchRes = await request.get(`/api/search?q=${encodeURIComponent(token)}`, {
        headers: API_KEY_HEADER,
      })
      expect(searchRes.status()).toBe(200)
      const searchBody = await searchRes.json()
      expect(searchBody.results).toEqual([])

      const getRes = await request.get(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER })
      expect(getRes.status()).toBe(404)

      const updateRes = await request.put(`/api/tasks/${taskId}`, {
        headers: API_KEY_HEADER,
        data: { title: 'cross-workspace-update' },
      })
      expect(updateRes.status()).toBe(404)

      const deleteRes = await request.delete(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER })
      expect(deleteRes.status()).toBe(404)

      expect(db.prepare('SELECT title, workspace_id FROM tasks WHERE id = ?').get(taskId)).toEqual({
        title: token,
        workspace_id: workspaceId,
      })
    } finally {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
      db.close()
    }
  })
})
