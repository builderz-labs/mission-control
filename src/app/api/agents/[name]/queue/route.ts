import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { computePriorityScore } from '@/lib/priority'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { name } = await params
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id

  const tasks = db.prepare(`
    SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.assigned_to = ? AND t.workspace_id = ? AND t.status IN ('assigned', 'in_progress')
    ORDER BY t.created_at DESC
  `).all(name, workspaceId) as any[]

  const queue = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    urgency: t.urgency ?? 3,
    due_date: t.due_date,
    priority_score: computePriorityScore(t.urgency ?? 3, t.due_date),
    project: t.project_name ?? 'General',
  })).sort((a, b) => b.priority_score - a.priority_score)

  return NextResponse.json({ agent: name, queue })
}
