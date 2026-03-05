import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { getIssue } from '@/lib/cc-db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const taskId = resolvedParams.id
    const body = await request.json()
    const author = (body.author || 'system') as string
    const message = (body.message || '').trim()

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Look up the issue in control-center.db
    const issue = getIssue(taskId)
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Subscribers still live in MC's own DB
    const db = getDatabase()
    const subscribers = new Set(db_helpers.getTaskSubscribers(parseInt(taskId) || 0))
    subscribers.delete(author)

    if (subscribers.size === 0) {
      return NextResponse.json({ sent: 0, skipped: 0 })
    }

    const agents = db
      .prepare('SELECT name, session_key FROM agents WHERE name IN (' + Array.from(subscribers).map(() => '?').join(',') + ')')
      .all(...Array.from(subscribers)) as Array<{ name: string; session_key?: string }>

    let sent = 0
    let skipped = 0

    for (const agent of agents) {
      if (!agent.session_key) {
        skipped += 1
        continue
      }
      try {
        await runOpenClaw(
          [
            'gateway',
            'sessions_send',
            '--session',
            agent.session_key,
            '--message',
            `[Task ${issue.id}] ${issue.title}\nFrom ${author}: ${message}`
          ],
          { timeoutMs: 10000 }
        )
        sent += 1
        db_helpers.createNotification(
          agent.name,
          'message',
          'Task Broadcast',
          `${author} broadcasted a message on "${issue.title}": ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
          'task',
          0
        )
      } catch (error) {
        skipped += 1
      }
    }

    db_helpers.logActivity(
      'task_broadcast',
      'task',
      0,
      author,
      `Broadcasted message to ${sent} subscribers`,
      { sent, skipped }
    )

    return NextResponse.json({ sent, skipped })
  } catch (error) {
    console.error('POST /api/tasks/[id]/broadcast error:', error)
    return NextResponse.json({ error: 'Failed to broadcast message' }, { status: 500 })
  }
}
