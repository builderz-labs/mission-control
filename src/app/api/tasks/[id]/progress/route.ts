import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'
import { computeProgressUpdates } from '@/lib/governance'

const progressSchema = z.object({
  agent: z.string().min(1).max(100),
  action: z.enum(['update', 'blocked', 'unblocked', 'complete']),
  message: z.string().min(1).max(5000),
  blocked_type: z.enum(['dependency', 'decision', 'inactivity']).optional(),
  blocked_reason: z.string().max(2000).optional(),
  artifacts: z.array(z.string()).default([]),
})

/**
 * POST /api/tasks/:id/progress
 * Agent reports progress on a task.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id: idStr } = await params
    const taskId = parseInt(idStr, 10)
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const validated = await validateBody(request, progressSchema)
    if ('error' in validated) return validated.error
    const { agent, action, message, blocked_type, blocked_reason, artifacts } = validated.data

    // Verify task exists and is assigned to this agent
    const task = db.prepare(`
      SELECT id, status, assigned_to, retry_count, max_retries, ack_at, first_artifact_at
      FROM tasks
      WHERE id = ? AND workspace_id = ?
    `).get(taskId, workspaceId) as any

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.assigned_to !== agent) {
      return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
    }

    const now = Math.floor(Date.now() / 1000)

    // Use governance helper to compute field updates
    const { fields, error: progressError } = computeProgressUpdates(task, {
      action,
      agent,
      message,
      blocked_type: blocked_type as any,
      blocked_reason,
      artifacts,
    }, now)

    if (progressError) {
      return NextResponse.json({
        error: `${progressError}. Task requires manual review.`,
      }, { status: 409 })
    }

    // Build SET clause from computed fields
    const setClauses: string[] = []
    const setParams: any[] = []
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) {
        setClauses.push(`${key} = NULL`)
      } else {
        setClauses.push(`${key} = ?`)
        setParams.push(value)
      }
    }

    if (setClauses.length > 0) {
      db.prepare(`
        UPDATE tasks SET ${setClauses.join(', ')}
        WHERE id = ? AND workspace_id = ?
      `).run(...setParams, taskId, workspaceId)
    }

    // Log activity (best-effort)
    try {
      db_helpers.logActivity(
        `task.progress.${action}`,
        'task',
        taskId,
        agent,
        message,
        { action, artifacts },
        workspaceId
      )
    } catch { /* activity logging is best-effort */ }

    // Broadcast event
    eventBus.broadcast('task.updated', {
      taskId,
      action: `progress.${action}`,
      agent,
      message,
      workspace_id: workspaceId,
    })

    return NextResponse.json({
      success: true,
      task_id: taskId,
      action,
      message: `Progress recorded: ${action}`,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/:id/progress error')
    return NextResponse.json({ error: 'Failed to record progress' }, { status: 500 })
  }
}
