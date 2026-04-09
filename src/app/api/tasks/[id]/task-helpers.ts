import { type SqlParam } from '@/lib/types/sql'
import { NextResponse } from 'next/server'
import { getDatabase, Task, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import { resolveMentionRecipients } from '@/lib/mentions'
import { normalizeTaskUpdateStatus } from '@/lib/task-status'
import { pushTaskToGitHub } from '@/lib/github-sync-engine'
import { pushTaskToGnap } from '@/lib/gnap-sync'
import { config } from '@/lib/config'

// Extended task row that includes GitHub integration columns not in the base Task type
export interface TaskWithGitHub extends Task {
  github_repo?: string | null
  github_issue_number?: number | null
  github_synced_at?: number | null
  github_branch?: string | null
  github_pr_number?: number | null
  github_pr_state?: string | null
  project_name?: string
  project_prefix?: string
}

interface ProjectSyncRow {
  id: number
  github_repo: string | null
  github_sync_enabled: number | null
}

const TASK_SELECT_COLUMNS = 'id, title, description, status, priority, assigned_to, created_by, created_at, updated_at, due_date, estimated_hours, actual_hours, tags, metadata, workspace_id, project_id, project_ticket_no, outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at, github_issue_number, github_repo, github_synced_at, github_branch, github_pr_number, github_pr_state'

export function formatTicketRef(prefix?: string | null, num?: number | null): string | undefined {
  if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return undefined
  return `${prefix}-${String(num).padStart(3, '0')}`
}

export function mapTaskRow(task: TaskWithGitHub): TaskWithGitHub & { tags: string[]; metadata: Record<string, unknown> } {
  return {
    ...task,
    tags: task.tags ? JSON.parse(task.tags as string) : [],
    metadata: task.metadata ? JSON.parse(task.metadata as string) : {},
    ticket_ref: formatTicketRef(task.project_prefix as string | null, task.project_ticket_no as number | null),
  }
}

export function hasAegisApproval(
  db: ReturnType<typeof getDatabase>,
  taskId: number,
  workspaceId: number
): boolean {
  const review = db.prepare(`
    SELECT status FROM quality_reviews
    WHERE task_id = ? AND reviewer = 'aegis' AND workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId, workspaceId) as { status?: string } | undefined
  return review?.status === 'approved'
}

export function fetchTaskById(taskId: number, workspaceId: number): TaskWithGitHub | undefined {
  const db = getDatabase()
  return db.prepare(`SELECT ${TASK_SELECT_COLUMNS} FROM tasks WHERE id = ? AND workspace_id = ?`)
    .get(taskId, workspaceId) as TaskWithGitHub | undefined
}

interface UpdateTaskBody {
  title?: string
  description?: string
  status?: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority?: 'critical' | 'high' | 'medium' | 'low'
  project_id?: number
  assigned_to?: string
  due_date?: number | null
  estimated_hours?: number | null
  actual_hours?: number | null
  outcome?: 'success' | 'failed' | 'partial' | 'abandoned' | null
  error_message?: string | null
  resolution?: string | null
  feedback_rating?: number | null
  feedback_notes?: string | null
  retry_count?: number | null
  completed_at?: number | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

export async function handleTaskUpdate(
  taskId: number,
  workspaceId: number,
  actor: string,
  body: UpdateTaskBody
): Promise<NextResponse> {
  const db = getDatabase()
  const currentTask = fetchTaskById(taskId, workspaceId)
  if (!currentTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const {
    title, description, status: requestedStatus, priority,
    project_id, assigned_to, due_date, estimated_hours, actual_hours,
    outcome, error_message, resolution, feedback_rating, feedback_notes,
    retry_count, completed_at, tags, metadata,
  } = body

  const normalizedStatus = normalizeTaskUpdateStatus({
    currentStatus: currentTask.status,
    requestedStatus,
    assignedTo: assigned_to,
    assignedToProvided: assigned_to !== undefined,
  })

  const now = Math.floor(Date.now() / 1000)
  const descriptionMentionResolution = description !== undefined
    ? resolveMentionRecipients(description || '', db, workspaceId)
    : null
  if (descriptionMentionResolution && descriptionMentionResolution.unresolved.length > 0) {
    return NextResponse.json({
      error: `Unknown mentions: ${descriptionMentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
      missing_mentions: descriptionMentionResolution.unresolved
    }, { status: 400 })
  }

  const previousDescriptionMentionRecipients = resolveMentionRecipients(currentTask.description || '', db, workspaceId).recipients

  const fieldsToUpdate: string[] = []
  const updateParams: SqlParam[] = []
  let nextProjectTicketNo: number | null = null

  if (title !== undefined) { fieldsToUpdate.push('title = ?'); updateParams.push(title) }
  if (description !== undefined) { fieldsToUpdate.push('description = ?'); updateParams.push(description) }
  if (normalizedStatus !== undefined) {
    if (normalizedStatus === 'done' && !hasAegisApproval(db, taskId, workspaceId)) {
      return NextResponse.json({ error: 'Aegis approval is required to move task to done.' }, { status: 403 })
    }
    fieldsToUpdate.push('status = ?'); updateParams.push(normalizedStatus)
  }
  if (priority !== undefined) { fieldsToUpdate.push('priority = ?'); updateParams.push(priority) }
  if (project_id !== undefined) {
    const project = db.prepare(`
      SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND status = 'active'
    `).get(project_id, workspaceId) as { id: number } | undefined
    if (!project) return NextResponse.json({ error: 'Project not found or archived' }, { status: 400 })
    if (project_id !== currentTask.project_id) {
      db.prepare('UPDATE projects SET ticket_counter = ticket_counter + 1, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?').run(project_id, workspaceId)
      const row = db.prepare('SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, workspaceId) as { ticket_counter: number } | undefined
      if (!row?.ticket_counter) return NextResponse.json({ error: 'Failed to allocate project ticket number' }, { status: 500 })
      nextProjectTicketNo = row.ticket_counter
    }
    fieldsToUpdate.push('project_id = ?'); updateParams.push(project_id)
    if (nextProjectTicketNo !== null) { fieldsToUpdate.push('project_ticket_no = ?'); updateParams.push(nextProjectTicketNo) }
  }
  if (assigned_to !== undefined) { fieldsToUpdate.push('assigned_to = ?'); updateParams.push(assigned_to) }
  if (due_date !== undefined) { fieldsToUpdate.push('due_date = ?'); updateParams.push(due_date) }
  if (estimated_hours !== undefined) { fieldsToUpdate.push('estimated_hours = ?'); updateParams.push(estimated_hours) }
  if (actual_hours !== undefined) { fieldsToUpdate.push('actual_hours = ?'); updateParams.push(actual_hours) }
  if (outcome !== undefined) { fieldsToUpdate.push('outcome = ?'); updateParams.push(outcome) }
  if (error_message !== undefined) { fieldsToUpdate.push('error_message = ?'); updateParams.push(error_message) }
  if (resolution !== undefined) { fieldsToUpdate.push('resolution = ?'); updateParams.push(resolution) }
  if (feedback_rating !== undefined) { fieldsToUpdate.push('feedback_rating = ?'); updateParams.push(feedback_rating) }
  if (feedback_notes !== undefined) { fieldsToUpdate.push('feedback_notes = ?'); updateParams.push(feedback_notes) }
  if (retry_count !== undefined) { fieldsToUpdate.push('retry_count = ?'); updateParams.push(retry_count) }
  if (completed_at !== undefined) {
    fieldsToUpdate.push('completed_at = ?'); updateParams.push(completed_at)
  } else if (normalizedStatus === 'done' && !currentTask.completed_at) {
    fieldsToUpdate.push('completed_at = ?'); updateParams.push(now)
  }
  if (tags !== undefined) { fieldsToUpdate.push('tags = ?'); updateParams.push(JSON.stringify(tags)) }
  if (metadata !== undefined) { fieldsToUpdate.push('metadata = ?'); updateParams.push(JSON.stringify(metadata)) }

  fieldsToUpdate.push('updated_at = ?')
  updateParams.push(now, taskId, workspaceId)

  if (fieldsToUpdate.length === 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  db.prepare(`UPDATE tasks SET ${fieldsToUpdate.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...updateParams)

  const changes: string[] = []

  if (normalizedStatus !== undefined && normalizedStatus !== currentTask.status) {
    changes.push(`status: ${currentTask.status} → ${normalizedStatus}`)
    if (currentTask.assigned_to) {
      db_helpers.createNotification(currentTask.assigned_to, 'status_change', 'Task Status Updated', `Task "${currentTask.title}" status changed to ${normalizedStatus}`, 'task', taskId, workspaceId)
    }
  }

  if (assigned_to !== undefined && assigned_to !== currentTask.assigned_to) {
    changes.push(`assigned: ${currentTask.assigned_to || 'unassigned'} → ${assigned_to || 'unassigned'}`)
    if (assigned_to) {
      db_helpers.ensureTaskSubscription(taskId, assigned_to, workspaceId)
      db_helpers.createNotification(assigned_to, 'assignment', 'Task Assigned', `You have been assigned to task: ${currentTask.title}`, 'task', taskId, workspaceId)
    }
  }

  if (title && title !== currentTask.title) changes.push('title updated')
  if (priority && priority !== currentTask.priority) changes.push(`priority: ${currentTask.priority} → ${priority}`)
  if (project_id !== undefined && project_id !== currentTask.project_id) changes.push(`project: ${currentTask.project_id || 'none'} → ${project_id}`)
  if (outcome !== undefined && outcome !== currentTask.outcome) changes.push(`outcome: ${currentTask.outcome || 'unset'} → ${outcome || 'unset'}`)

  if (descriptionMentionResolution) {
    const newMentionRecipients = new Set(descriptionMentionResolution.recipients)
    const previousRecipients = new Set(previousDescriptionMentionRecipients)
    for (const recipient of newMentionRecipients) {
      if (previousRecipients.has(recipient)) continue
      db_helpers.ensureTaskSubscription(taskId, recipient, workspaceId)
      if (recipient === actor) continue
      db_helpers.createNotification(recipient, 'mention', 'You were mentioned in a task description', `${actor} mentioned you in task "${title || currentTask.title}"`, 'task', taskId, workspaceId)
    }
  }

  if (changes.length > 0) {
    db_helpers.logActivity(
      'task_updated', 'task', taskId, actor,
      `Task updated: ${changes.join(', ')}`,
      { changes, oldValues: { title: currentTask.title, status: currentTask.status, priority: currentTask.priority, assigned_to: currentTask.assigned_to }, newValues: { title, status: normalizedStatus ?? currentTask.status, priority, assigned_to } },
      workspaceId
    )
  }

  const updatedTask = db.prepare(`
    SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.id = ? AND t.workspace_id = ?
  `).get(taskId, workspaceId) as TaskWithGitHub
  const parsedTask = mapTaskRow(updatedTask)

  // Fire-and-forget outbound GitHub sync for relevant changes
  const syncRelevantChanges = changes.some(c =>
    c.startsWith('status:') || c.startsWith('priority:') || c.includes('title') || c.includes('assigned')
  )
  if (syncRelevantChanges && updatedTask.github_repo) {
    const project = db.prepare('SELECT id, github_repo, github_sync_enabled FROM projects WHERE id = ? AND workspace_id = ?')
      .get(updatedTask.project_id, workspaceId) as ProjectSyncRow | undefined
    if (project?.github_sync_enabled) {
      pushTaskToGitHub(updatedTask, project).catch(err =>
        logger.error({ err, taskId }, 'Outbound GitHub sync failed')
      )
    }
  }

  // Fire-and-forget GNAP sync for task updates
  if (config.gnap.enabled && config.gnap.autoSync && changes.length > 0) {
    try { pushTaskToGnap(updatedTask, config.gnap.repoPath) }
    catch (err) { logger.warn({ err, taskId }, 'GNAP sync failed for task update') }
  }

  eventBus.broadcast('task.updated', parsedTask)

  return NextResponse.json({ task: parsedTask })
}
