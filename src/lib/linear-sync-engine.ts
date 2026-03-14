/**
 * Linear Sync Engine — bidirectional sync between MC tasks and Linear issues.
 */

import { getDatabase, db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  fetchIssues,
  fetchIssue,
  updateIssue,
  createIssue,
  type LinearIssue,
} from '@/lib/linear'
import {
  statusToLinearStateType,
  linearStateTypeToStatus,
  findMatchingWorkflowState,
  priorityToLinear,
  linearToPriority,
} from '@/lib/linear-map'

export async function pushTaskToLinear(
  task: {
    id: number
    title: string
    description?: string | null
    status: string
    priority: string
    linear_issue_id?: string | null
    linear_team_id?: string | null
    assigned_to?: string | null
    workspace_id: number
  },
  project: {
    id: number
    linear_team_id?: string | null
    linear_sync_enabled?: number | null
  },
  workflowStates: any[]
): Promise<void> {
  const teamId = task.linear_team_id || project.linear_team_id
  if (!teamId) return

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const priority = priorityToLinear(task.priority as any)
  const matchingState = findMatchingWorkflowState(task.status as any, workflowStates)
  const stateId = matchingState?.id

  // Resolve assignee from user mappings
  let assigneeId: string | undefined
  if (task.assigned_to) {
    const mapping = db.prepare(`
      SELECT linear_user_id FROM linear_user_mappings
      WHERE mc_agent_name = ? AND workspace_id = ?
    `).get(task.assigned_to, task.workspace_id) as { linear_user_id: string } | undefined
    assigneeId = mapping?.linear_user_id
  }

  if (task.linear_issue_id) {
    let existingIssue: LinearIssue
    try {
      existingIssue = await fetchIssue(task.linear_issue_id)
    } catch (err) {
      logger.error({ err, issueId: task.linear_issue_id }, 'Failed to fetch Linear issue for update')
      return
    }

    if (!existingIssue) {
      logger.warn({ issueId: task.linear_issue_id }, 'Linear issue not found, will recreate')
      task.linear_issue_id = null
    } else {
      await updateIssue(task.linear_issue_id, {
        title: task.title,
        description: task.description || undefined,
        priority,
        stateId,
        assigneeId,
      })

      db.prepare(`
        UPDATE tasks SET linear_synced_at = ? WHERE id = ?
      `).run(now, task.id)

      logger.info({ issueId: task.linear_issue_id }, 'Pushed task update to Linear')
      return
    }
  }

  if (project.linear_sync_enabled) {
    const created = await createIssue(teamId, {
      title: task.title,
      description: task.description || undefined,
      priority,
      stateId,
      assigneeId,
    })

    db.prepare(`
      UPDATE tasks
      SET linear_issue_id = ?, linear_team_id = ?, linear_synced_at = ?
      WHERE id = ?
    `).run(created.id, teamId, now, task.id)

    logger.info({ issueId: created.id, taskId: task.id }, 'Created Linear issue for task')
  }
}

export async function pullFromLinear(
  project: {
    id: number
    linear_team_id?: string | null
    linear_sync_enabled?: number | null
  },
  workspaceId: number
): Promise<{ pulled: number; pushed: number }> {
  const teamId = project.linear_team_id
  if (!teamId || !project.linear_sync_enabled) {
    return { pulled: 0, pushed: 0 }
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  let pulled = 0
  let pushed = 0

  const { fetchWorkflowStates } = await import('@/lib/linear')
  const workflowStates = await fetchWorkflowStates(teamId)

  const lastSync = db.prepare(`
    SELECT last_synced_at FROM linear_syncs
    WHERE team_id = ? AND workspace_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(teamId, workspaceId) as { last_synced_at: number } | undefined

  const sinceDate = lastSync
    ? new Date(lastSync.last_synced_at * 1000).toISOString()
    : undefined

  let issues: LinearIssue[]
  try {
    const result = await fetchIssues(teamId, {
      filter: sinceDate ? { updatedAt: { gte: sinceDate } } : undefined,
      first: 100,
      orderBy: 'updatedAt',
    })
    issues = result.issues
  } catch (err) {
    logger.error({ err, teamId }, 'Failed to fetch issues from Linear')

    db.prepare(`
      INSERT INTO linear_syncs (team_id, last_synced_at, issue_count, sync_direction, status, error, project_id, workspace_id)
      VALUES (?, ?, 0, 'inbound', 'error', ?, ?, ?)
    `).run(teamId, now, (err as Error).message, project.id, workspaceId)

    return { pulled: 0, pushed: 0 }
  }

  for (const issue of issues) {
    try {
      const existingTask = db.prepare(`
        SELECT * FROM tasks
        WHERE linear_issue_id = ? AND workspace_id = ?
      `).get(issue.id, workspaceId) as any | undefined

      const issueUpdatedAt = Math.floor(new Date(issue.updatedAt).getTime() / 1000)
      const status = linearStateTypeToStatus(issue.state.type, issue.state.name)
      const priority = linearToPriority(issue.priority)

      if (!existingTask) {
        const labelNames = issue.labels.nodes.map(l => l.name)

        db.prepare(`
          INSERT INTO tasks (
            title, description, status, priority, created_by,
            created_at, updated_at, tags, metadata,
            linear_issue_id, linear_team_id, linear_synced_at,
            project_id, workspace_id
          ) VALUES (?, ?, ?, ?, 'linear-sync', ?, ?, ?, '{}', ?, ?, ?, ?, ?)
        `).run(
          issue.title,
          issue.description || '',
          status,
          priority,
          now, now,
          JSON.stringify(labelNames),
          issue.id, teamId, now,
          project.id, workspaceId
        )

        pulled++

        db_helpers.logActivity(
          'task_created', 'task', 0, 'linear-sync',
          `Synced from Linear: ${issue.identifier}`,
          { linear_issue: issue.id, linear_identifier: issue.identifier },
          workspaceId
        )
      } else {
        if (existingTask.linear_synced_at && Math.abs(existingTask.linear_synced_at - issueUpdatedAt) < 10) {
          continue
        }

        if (issueUpdatedAt <= existingTask.updated_at) {
          continue
        }

        db.prepare(`
          UPDATE tasks
          SET title = ?, description = ?, status = ?, priority = ?,
              linear_synced_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `).run(
          issue.title,
          issue.description || '',
          status,
          priority,
          now, now,
          existingTask.id, workspaceId
        )

        pulled++

        db_helpers.logActivity(
          'task_updated', 'task', existingTask.id, 'linear-sync',
          `Updated from Linear: ${issue.identifier}`,
          { linear_issue: issue.id, linear_identifier: issue.identifier },
          workspaceId
        )
      }
    } catch (err) {
      logger.error({ err, issueId: issue.id }, 'Failed to sync Linear issue')
    }
  }

  db.prepare(`
    INSERT INTO linear_syncs (team_id, last_synced_at, issue_count, sync_direction, status, project_id, changes_pushed, changes_pulled, workspace_id)
    VALUES (?, ?, ?, 'inbound', 'success', ?, ?, ?, ?)
  `).run(teamId, now, pulled, project.id, pushed, pulled, workspaceId)

  logger.info({ teamId, pulled, pushed, projectId: project.id }, 'Linear sync completed')

  return { pulled, pushed }
}

/**
 * Get Linear user ID mapping for an MC agent.
 */
export function getUserMapping(agentName: string, workspaceId: number): string | null {
  const db = getDatabase()
  const mapping = db.prepare(`
    SELECT linear_user_id FROM linear_user_mappings
    WHERE mc_agent_name = ? AND workspace_id = ?
  `).get(agentName, workspaceId) as { linear_user_id: string } | undefined
  return mapping?.linear_user_id || null
}

/**
 * Set or update Linear user ID mapping for an MC agent.
 */
export function setUserMapping(agentName: string, linearUserId: string, workspaceId: number): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO linear_user_mappings (mc_agent_name, linear_user_id, workspace_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, mc_agent_name) DO UPDATE SET
      linear_user_id = excluded.linear_user_id,
      updated_at = excluded.updated_at
  `).run(agentName, linearUserId, workspaceId, now)
}

/**
 * Delete Linear user ID mapping.
 */
export function deleteUserMapping(agentName: string, workspaceId: number): void {
  const db = getDatabase()
  db.prepare(`
    DELETE FROM linear_user_mappings
    WHERE mc_agent_name = ? AND workspace_id = ?
  `).run(agentName, workspaceId)
}

/**
 * Get all user mappings for a workspace.
 */
export function getAllUserMappings(workspaceId: number): Array<{ mc_agent_name: string; linear_user_id: string }> {
  const db = getDatabase()
  return db.prepare(`
    SELECT mc_agent_name, linear_user_id FROM linear_user_mappings
    WHERE workspace_id = ?
  `).all(workspaceId) as Array<{ mc_agent_name: string; linear_user_id: string }>
}
