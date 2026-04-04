import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'

interface TaskRow {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string | null
  created_by: string
  created_at: number
  updated_at: number
  due_date: number | null
  estimated_hours: number | null
  actual_hours: number | null
  tags: string | null
  metadata: string | null
  workspace_id: number
  project_id: number | null
  project_ticket_no: number | null
  outcome: string | null
  error_message: string | null
  resolution: string | null
  feedback_rating: number | null
  feedback_notes: string | null
  retry_count: number | null
  completed_at: number | null
  github_issue_number: number | null
  github_repo: string | null
  github_synced_at: number | null
  github_branch: string | null
  github_pr_number: number | null
  github_pr_state: string | null
}
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)
    const body = await request.json()
    const workspaceId = auth.user.workspace_id ?? 1;
    const author = auth.user.display_name || auth.user.username || 'system'
    const message = (body.message || '').trim()

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const db = getDatabase()
    const task = db
      .prepare('SELECT id, title, description, status, priority, assigned_to, created_by, created_at, updated_at, due_date, estimated_hours, actual_hours, tags, metadata, workspace_id, project_id, project_ticket_no, outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at, github_issue_number, github_repo, github_synced_at, github_branch, github_pr_number, github_pr_state FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as TaskRow | undefined
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const subscribers = new Set(db_helpers.getTaskSubscribers(taskId, workspaceId))
    subscribers.delete(author)

    if (subscribers.size === 0) {
      return NextResponse.json({ sent: 0, skipped: 0 })
    }

    const agents = db
      .prepare('SELECT name, session_key FROM agents WHERE workspace_id = ? AND name IN (' + Array.from(subscribers).map(() => '?').join(',') + ')')
      .all(workspaceId, ...Array.from(subscribers)) as Array<{ name: string; session_key?: string }>

    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        if (!agent.session_key) return 'skipped'
        await runOpenClaw(
          [
            'gateway',
            'sessions_send',
            '--session',
            agent.session_key,
            '--message',
            `[Task ${task.id}] ${task.title}\nFrom ${author}: ${message}`
          ],
          { timeoutMs: 10000 }
        )
        db_helpers.createNotification(
          agent.name,
          'message',
          'Task Broadcast',
          `${author} broadcasted a message on "${task.title}": ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
          'task',
          taskId,
          workspaceId
        )
        return 'sent'
      })
    )

    let sent = 0
    let skipped = 0
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === 'sent') sent++
      else skipped++
    }

    db_helpers.logActivity(
      'task_broadcast',
      'task',
      taskId,
      author,
      `Broadcasted message to ${sent} subscribers`,
      { sent, skipped },
      workspaceId
    )

    return NextResponse.json({ sent, skipped })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/broadcast error')
    return NextResponse.json({ error: 'Failed to broadcast message' }, { status: 500 })
  }
}
