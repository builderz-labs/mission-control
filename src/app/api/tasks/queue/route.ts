import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Task } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

type QueueReason = 'continue_current' | 'assigned' | 'at_capacity' | 'no_tasks_available'

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function mapTaskRow(task: any) {
  return {
    ...task,
    tags: safeParseJson(task.tags, [] as string[]),
    metadata: safeParseJson(task.metadata, {} as Record<string, unknown>),
  }
}

function priorityRankSql() {
  return `
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END
  `
}

/**
 * GET /api/tasks/queue - Poll next task for an agent.
 *
 * Query params:
 * - agent: required agent name (or use x-agent-name header)
 * - max_capacity: optional integer 1..20 (default 1)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)

    const agent =
      (searchParams.get('agent') || '').trim() ||
      (request.headers.get('x-agent-name') || '').trim()

    if (!agent) {
      return NextResponse.json({ error: 'Missing agent. Provide ?agent=... or x-agent-name header.' }, { status: 400 })
    }

    const maxCapacityRaw = searchParams.get('max_capacity') || '1'
    if (!/^\d+$/.test(maxCapacityRaw)) {
      return NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 })
    }
    const maxCapacity = Number(maxCapacityRaw)
    if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 20) {
      return NextResponse.json({ error: 'Invalid max_capacity. Expected integer 1..20.' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)

    const currentTask = db.prepare(`
      SELECT *
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(workspaceId, agent) as Task | undefined

    if (currentTask) {
      return NextResponse.json({
        task: mapTaskRow(currentTask),
        reason: 'continue_current' as QueueReason,
        agent,
        timestamp: now,
      })
    }

    const inProgressCount = (db.prepare(`
      SELECT COUNT(*) as c
      FROM tasks
      WHERE workspace_id = ? AND assigned_to = ? AND status = 'in_progress'
    `).get(workspaceId, agent) as { c: number }).c

    if (inProgressCount >= maxCapacity) {
      return NextResponse.json({
        task: null,
        reason: 'at_capacity' as QueueReason,
        agent,
        timestamp: now,
      })
    }

    // Best-effort atomic pickup loop for race safety.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = db.prepare(`
        SELECT *
        FROM tasks
        WHERE workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
        ORDER BY ${priorityRankSql()} ASC, due_date ASC NULLS LAST, created_at ASC
        LIMIT 1
      `).get(workspaceId, agent) as Task | undefined

      if (!candidate) break

      const claimed = db.prepare(`
        UPDATE tasks
        SET status = 'in_progress', assigned_to = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
      `).run(agent, now, candidate.id, workspaceId, agent)

      if (claimed.changes > 0) {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(candidate.id, workspaceId) as Task | undefined
        return NextResponse.json({
          task: mapTaskRow(task),
          reason: 'assigned' as QueueReason,
          agent,
          timestamp: now,
        })
      }
    }

    return NextResponse.json({
      task: null,
      reason: 'no_tasks_available' as QueueReason,
      agent,
      timestamp: now,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/queue error')
    return NextResponse.json({ error: 'Failed to poll task queue' }, { status: 500 })
  }
}
