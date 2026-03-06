import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
      .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as any
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
