import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { agentTaskLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'

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

  const rateLimited = agentTaskLimiter(request)
  if (rateLimited) return rateLimited

  try {
    const db = getDatabase()
    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) return wsResult.response
    const { workspaceId } = wsResult
    const { searchParams } = new URL(request.url)

    const agent =
      (searchParams.get('agent') || '').trim() ||
      (request.headers.get('x-agent-name') || '').trim()

    if (!agent) {
      return NextResponse.json({ error: 'Missing agent. Provide ?agent=... or x-agent-name header.' }, { status: 400 })
    }

    // Agent keys (non-admin) may only queue for themselves
    if (auth.user.agent_name && auth.user.role !== 'admin' && agent !== auth.user.agent_name) {
      return NextResponse.json({ error: 'Access denied: agent key may only queue tasks for itself.' }, { status: 403 })
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
    `).get(workspaceId, agent) as any | undefined

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

    // Atomic claim: single UPDATE with subquery to eliminate SELECT-UPDATE race condition.
    const claimed = db.prepare(`
      UPDATE tasks
      SET status = 'in_progress', assigned_to = ?, updated_at = ?
      WHERE id = (
        SELECT id FROM tasks
        WHERE workspace_id = ?
          AND status IN ('assigned', 'inbox')
          AND (assigned_to IS NULL OR assigned_to = ?)
        ORDER BY ${priorityRankSql()} ASC, due_date ASC NULLS LAST, created_at ASC
        LIMIT 1
      )
      RETURNING *
    `).get(agent, now, workspaceId, agent) as any | undefined

    if (claimed) {
      return NextResponse.json({
        task: mapTaskRow(claimed),
        reason: 'assigned' as QueueReason,
        agent,
        timestamp: now,
      })
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
