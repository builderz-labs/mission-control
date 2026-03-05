import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { normalizeTaskStatus } from '@/lib/task-workflow'
import { eventBus } from '@/lib/event-bus'

interface ApprovalBody {
  action: 'approve' | 'reject'
  summary: string
  rationale?: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolved = await params
    const taskId = Number(resolved.id)
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const approvals = db.prepare(
      `SELECT id, task_id, action, summary, rationale, actor, metadata, created_at
       FROM task_approvals
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC`
    ).all(taskId) as any[]

    const latest = approvals[0] || null
    const parsed = approvals.map((a) => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null,
    }))

    return NextResponse.json({ latest: latest ? { ...latest, metadata: latest.metadata ? JSON.parse(latest.metadata) : null } : null, approvals: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/approval error')
    return NextResponse.json({ error: 'Failed to fetch approvals' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolved = await params
    const taskId = Number(resolved.id)
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const body = (await request.json()) as ApprovalBody
    if (!body || (body.action !== 'approve' && body.action !== 'reject')) {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
    }
    if (!body.summary || !String(body.summary).trim()) {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)
    const actor = auth.user.username

    const insert = db.prepare(`
      INSERT INTO task_approvals (task_id, action, summary, rationale, actor, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const approvalMeta = {
      taskStatusAtDecision: normalizeTaskStatus(task.status),
      taskTitle: task.title,
    }

    const result = insert.run(
      taskId,
      body.action,
      String(body.summary).trim(),
      body.rationale ? String(body.rationale).trim() : null,
      actor,
      JSON.stringify(approvalMeta),
      now,
    )

    // One-click behavior
    const nextStatus = body.action === 'approve'
      ? (normalizeTaskStatus(task.status) === 'review' ? 'done' : 'todo')
      : 'blocked'

    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, taskId)

    db_helpers.logActivity(
      body.action === 'approve' ? 'task_approved' : 'task_rejected',
      'task',
      taskId,
      actor,
      `${body.action === 'approve' ? 'Approved' : 'Rejected'} task: ${task.title}`,
      {
        summary: body.summary,
        rationale: body.rationale || null,
        nextStatus,
      }
    )

    eventBus.broadcast('task.updated', { id: taskId, status: nextStatus, updated_at: now })

    return NextResponse.json({
      approval: {
        id: Number(result.lastInsertRowid),
        task_id: taskId,
        action: body.action,
        summary: body.summary,
        rationale: body.rationale || null,
        actor,
        metadata: approvalMeta,
        created_at: now,
      },
      task: {
        id: taskId,
        status: nextStatus,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/approval error')
    return NextResponse.json({ error: 'Failed to submit approval decision' }, { status: 500 })
  }
}
