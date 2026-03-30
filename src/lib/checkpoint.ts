import { getDatabase } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'

export interface WorkCheckpoint {
  id: number
  workspace_id: number
  task_id: string
  agent_id: string
  checkpoint_type: 'auto' | 'manual' | 'crash_recovery'
  state_summary: string
  files_snapshot: string | null
  context_data: string | null
  created_at: number
}

/**
 * Save an immutable work checkpoint for crash recovery.
 */
export function saveCheckpoint(input: {
  workspaceId: number
  taskId: string
  agentId: string
  checkpointType?: 'auto' | 'manual' | 'crash_recovery'
  stateSummary: string
  filesSnapshot?: Record<string, string> | null
  contextData?: Record<string, unknown> | null
}): WorkCheckpoint {
  const db = getDatabase()

  const result = db.prepare(`
    INSERT INTO work_checkpoints (workspace_id, task_id, agent_id, checkpoint_type, state_summary, files_snapshot, context_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.workspaceId,
    input.taskId,
    input.agentId,
    input.checkpointType ?? 'auto',
    input.stateSummary,
    input.filesSnapshot ? JSON.stringify(input.filesSnapshot) : null,
    input.contextData ? JSON.stringify(input.contextData) : null
  )

  // Update agent_health.last_checkpoint_at
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE agent_health SET last_checkpoint_at = ?, updated_at = ?
    WHERE workspace_id = ? AND agent_id = ?
  `).run(now, now, input.workspaceId, input.agentId)

  eventBus.broadcast('agent.checkpoint_saved', {
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    task_id: input.taskId,
  })

  const checkpoint = db.prepare(
    'SELECT * FROM work_checkpoints WHERE id = ?'
  ).get(result.lastInsertRowid) as WorkCheckpoint

  logger.info({ taskId: input.taskId, agentId: input.agentId, type: input.checkpointType }, 'Checkpoint saved')

  return checkpoint
}

/**
 * Get the latest checkpoint for a task.
 */
export function getLatestCheckpoint(workspaceId: number, taskId: string): WorkCheckpoint | null {
  const db = getDatabase()
  return (db.prepare(
    'SELECT * FROM work_checkpoints WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(workspaceId, taskId) as WorkCheckpoint | undefined) ?? null
}

/**
 * Get all checkpoints for a task.
 */
export function getCheckpoints(workspaceId: number, taskId: string): WorkCheckpoint[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM work_checkpoints WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC'
  ).all(workspaceId, taskId) as WorkCheckpoint[]
}

/**
 * Build markdown context from the latest checkpoint for injection into
 * a re-dispatch message. Same pattern as formatMailForDispatch().
 */
export function buildCheckpointContext(workspaceId: number, taskId: string): string | null {
  const checkpoint = getLatestCheckpoint(workspaceId, taskId)
  if (!checkpoint) return null

  const lines = [
    '## Recovery Checkpoint',
    '',
    `**Type**: ${checkpoint.checkpoint_type}`,
    `**Saved**: ${new Date(checkpoint.created_at * 1000).toISOString()}`,
    `**Agent**: ${checkpoint.agent_id}`,
    '',
    '### State Summary',
    checkpoint.state_summary,
  ]

  if (checkpoint.files_snapshot) {
    try {
      const files = JSON.parse(checkpoint.files_snapshot) as Record<string, string>
      const fileNames = Object.keys(files)
      if (fileNames.length > 0) {
        lines.push('', '### Files in Progress', ...fileNames.map(f => `- ${f}`))
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (checkpoint.context_data) {
    try {
      const ctx = JSON.parse(checkpoint.context_data) as Record<string, unknown>
      if (Object.keys(ctx).length > 0) {
        lines.push('', '### Additional Context', '```json', JSON.stringify(ctx, null, 2), '```')
      }
    } catch {
      // Ignore parse errors
    }
  }

  return lines.join('\n')
}
