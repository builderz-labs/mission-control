import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Task, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { getUserFromRequest, requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, updateTaskSchema } from '@/lib/validation'
import { hasApprovedTask } from '@/lib/task-approvals'
import { normalizeTaskStatus, requiresExternalApproval, shouldRequireApprovalForDone } from '@/lib/task-workflow'

/**
 * GET /api/tasks/[id] - Get a specific task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?')
    const task = stmt.get(taskId) as Task

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const taskWithParsedData = {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      metadata: task.metadata ? JSON.parse(task.metadata) : {},
      status: normalizeTaskStatus(task.status),
    }

    return NextResponse.json({ task: taskWithParsedData })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id] error')
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 })
  }
}

/**
 * PUT /api/tasks/[id] - Update a specific task
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)
    const validated = await validateBody(request, updateTaskSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task

    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      due_date,
      estimated_hours,
      actual_hours,
      tags,
      metadata,
    } = body

    const now = Math.floor(Date.now() / 1000)

    const fieldsToUpdate = []
    const updateParams: any[] = []

    if (title !== undefined) {
      fieldsToUpdate.push('title = ?')
      updateParams.push(title)
    }
    if (description !== undefined) {
      fieldsToUpdate.push('description = ?')
      updateParams.push(description)
    }
    if (status !== undefined) {
      const parsedMetadata = metadata !== undefined
        ? metadata
        : (currentTask.metadata ? JSON.parse(currentTask.metadata) : {})
      let normalizedNext = normalizeTaskStatus(status)

      if (shouldRequireApprovalForDone(currentTask.status, normalizedNext, parsedMetadata) && !hasApprovedTask(taskId)) {
        return NextResponse.json(
          { error: 'Approval is required before this task can be moved to done.' },
          { status: 403 }
        )
      }

      if (requiresExternalApproval(parsedMetadata) && !hasApprovedTask(taskId) && normalizedNext !== 'done') {
        normalizedNext = 'needs-approval'
      }

      fieldsToUpdate.push('status = ?')
      updateParams.push(normalizedNext)
    }
    if (priority !== undefined) {
      fieldsToUpdate.push('priority = ?')
      updateParams.push(priority)
    }
    if (assigned_to !== undefined) {
      fieldsToUpdate.push('assigned_to = ?')
      updateParams.push(assigned_to)
    }
    if (due_date !== undefined) {
      fieldsToUpdate.push('due_date = ?')
      updateParams.push(due_date)
    }
    if (estimated_hours !== undefined) {
      fieldsToUpdate.push('estimated_hours = ?')
      updateParams.push(estimated_hours)
    }
    if (actual_hours !== undefined) {
      fieldsToUpdate.push('actual_hours = ?')
      updateParams.push(actual_hours)
    }
    if (tags !== undefined) {
      fieldsToUpdate.push('tags = ?')
      updateParams.push(JSON.stringify(tags))
    }
    if (metadata !== undefined) {
      fieldsToUpdate.push('metadata = ?')
      updateParams.push(JSON.stringify(metadata))
    }

    fieldsToUpdate.push('updated_at = ?')
    updateParams.push(now)
    updateParams.push(taskId)

    if (fieldsToUpdate.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const stmt = db.prepare(`
      UPDATE tasks
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = ?
    `)

    stmt.run(...updateParams)

    const changes: string[] = []

    if (status && normalizeTaskStatus(status) !== normalizeTaskStatus(currentTask.status)) {
      const normalized = normalizeTaskStatus(status)
      changes.push(`status: ${normalizeTaskStatus(currentTask.status)} → ${normalized}`)

      if (currentTask.assigned_to) {
        db_helpers.createNotification(
          currentTask.assigned_to,
          'status_change',
          'Task Status Updated',
          `Task "${currentTask.title}" status changed to ${normalized}`,
          'task',
          taskId
        )
      }
    }

    if (assigned_to !== undefined && assigned_to !== currentTask.assigned_to) {
      changes.push(`assigned: ${currentTask.assigned_to || 'unassigned'} → ${assigned_to || 'unassigned'}`)

      if (assigned_to) {
        db_helpers.ensureTaskSubscription(taskId, assigned_to)
        db_helpers.createNotification(
          assigned_to,
          'assignment',
          'Task Assigned',
          `You have been assigned to task: ${currentTask.title}`,
          'task',
          taskId
        )
      }
    }

    if (title && title !== currentTask.title) {
      changes.push('title updated')
    }

    if (priority && priority !== currentTask.priority) {
      changes.push(`priority: ${currentTask.priority} → ${priority}`)
    }

    if (changes.length > 0) {
      db_helpers.logActivity(
        'task_updated',
        'task',
        taskId,
        getUserFromRequest(request)?.username || 'system',
        `Task updated: ${changes.join(', ')}`,
        {
          changes,
          oldValues: {
            title: currentTask.title,
            status: normalizeTaskStatus(currentTask.status),
            priority: currentTask.priority,
            assigned_to: currentTask.assigned_to,
          },
          newValues: { title, status: status ? normalizeTaskStatus(status) : undefined, priority, assigned_to },
        }
      )
    }

    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task
    const parsedTask = {
      ...updatedTask,
      tags: updatedTask.tags ? JSON.parse(updatedTask.tags) : [],
      metadata: updatedTask.metadata ? JSON.parse(updatedTask.metadata) : {},
      status: normalizeTaskStatus(updatedTask.status),
    }

    eventBus.broadcast('task.updated', parsedTask)

    return NextResponse.json({ task: parsedTask })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id] error')
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

/**
 * DELETE /api/tasks/[id] - Delete a specific task
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // If this is an external mirrored task, record a tombstone so sync doesn't recreate it.
    try {
      const metadata = task.metadata ? JSON.parse(task.metadata as any) : {}
      const external = metadata?.external
      if (external?.source && external?.taskId) {
        db.prepare(`
          INSERT INTO external_task_tombstones (source, external_id, deleted_by, reason, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source, external_id) DO UPDATE SET
            deleted_by = excluded.deleted_by,
            reason = excluded.reason,
            created_at = excluded.created_at
        `).run(
          String(external.source),
          String(external.taskId),
          getUserFromRequest(request)?.username || 'system',
          'user_deleted_task',
          Math.floor(Date.now() / 1000),
        )
      }
    } catch {
      // best effort only
    }

    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?')
    stmt.run(taskId)

    db_helpers.logActivity(
      'task_deleted',
      'task',
      taskId,
      getUserFromRequest(request)?.username || 'system',
      `Deleted task: ${task.title}`,
      {
        title: task.title,
        status: normalizeTaskStatus(task.status),
        assigned_to: task.assigned_to,
      }
    )

    eventBus.broadcast('task.deleted', { id: taskId, title: task.title })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id] error')
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
