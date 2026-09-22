import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { FleetProjectSpec } from '@/lib/fleet-projects'

function expandHome(value: string): string {
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function gitCount(cwd: string, args: string[]): number {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 8_000 })
    const lines = out.split('\n').map((line) => line.trim()).filter(Boolean)
    if (args.includes('--count')) return Number.parseInt(out.trim(), 10) || 0
    return lines.length
  } catch {
    return 0
  }
}

function inspectRepo(spec: FleetProjectSpec): { dirty: number; unpushed: number; path: string } | null {
  const repoPath = expandHome(spec.path)
  if (!existsSync(path.join(repoPath, '.git'))) return null
  const dirty = gitCount(repoPath, ['status', '--porcelain'])
  const unpushed = gitCount(repoPath, ['rev-list', '--count', '--branches', '--not', '--remotes'])
  return { dirty, unpushed, path: repoPath }
}

export function seedRepoHealthTasks(
  db: SqliteDatabase,
  workspaceId: number,
  specs: FleetProjectSpec[],
): { upserted: number; dirty: number } {
  const now = Math.floor(Date.now() / 1000)
  const find = db.prepare(
    `SELECT id FROM tasks WHERE workspace_id = ? AND title = ? LIMIT 1`,
  )
  const insert = db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, assigned_to, created_by,
      created_at, updated_at, workspace_id, project_id, metadata
    ) VALUES (?, ?, ?, 'medium', 'claude-1', 'scheduler', ?, ?, ?, ?, ?)
  `)
  const update = db.prepare(
    `UPDATE tasks SET description = ?, status = ?, updated_at = ?, project_id = ? WHERE id = ?`,
  )
  const projectBySlug = new Map(
    (db.prepare('SELECT id, slug FROM projects WHERE workspace_id = ?').all(workspaceId) as Array<{ id: number; slug: string }>)
      .map((row) => [row.slug, row.id]),
  )
  let upserted = 0
  let dirtyCount = 0
  const tx = db.transaction(() => {
    for (const spec of specs) {
      const info = inspectRepo(spec)
      if (!info) continue
      const dirty = info.dirty > 0 || info.unpushed > 0
      if (dirty) dirtyCount += 1
      const title = `Repo health: ${spec.name}`
      const description = dirty
        ? `${info.path}: ${info.dirty} dirty path(s), ${info.unpushed} unpushed commit(s).`
        : `${info.path}: working tree clean.`
      const status = dirty ? 'inbox' : 'done'
      const metadata = JSON.stringify({ kind: 'repo-health', slug: spec.slug })
      const existing = find.get(workspaceId, title) as { id: number } | undefined
      const projectId = projectBySlug.get(spec.slug) ?? null
      if (existing) {
        update.run(description, status, now, projectId, existing.id)
      } else {
        insert.run(title, description, status, now, now, workspaceId, projectId, metadata)
      }
      upserted += 1
    }
  })
  tx()
  return { upserted, dirty: dirtyCount }
}
