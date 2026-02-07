import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)
    const body = await request.json()
    const author = (body.author || 'system') as string
    const message = (body.message || '').trim()

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const db = getDatabase()
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const subscribers = new Set(db_helpers.getTaskSubscribers(taskId))
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
            `[Task ${task.id}] ${task.title}\nFrom ${author}: ${message}`
          ],
          { timeoutMs: 10000 }
        )
        sent += 1
        db_helpers.createNotification(
          agent.name,
          'message',
          'Task Broadcast',
          `${author} broadcasted a message on "${task.title}": ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`,
          'task',
          taskId
        )
      } catch (error) {
        skipped += 1
      }
    }

    db_helpers.logActivity(
      'task_broadcast',
      'task',
      taskId,
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
