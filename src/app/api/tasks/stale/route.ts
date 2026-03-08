import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id
  const now = Math.floor(Date.now() / 1000)

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.assigned_to, t.updated_at, t.status,
           p.name as project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.workspace_id = ?
      AND (
        (t.status = 'in_progress' AND t.updated_at < ?)
        OR (t.status = 'assigned' AND t.updated_at < ?)
      )
    ORDER BY t.updated_at ASC
  `).all(workspaceId, now - 7200, now - 14400) as any[]

  const staleTasks = tasks.map(t => ({
    id: t.id,
    title: t.title,
    assigned_to: t.assigned_to,
    updated_at: t.updated_at,
    status: t.status,
    project: t.project_name ?? 'General',
    hours_stale: Math.round((now - t.updated_at) / 3600 * 10) / 10,
  }))

  return NextResponse.json({ stale_tasks: staleTasks, count: staleTasks.length })
}
