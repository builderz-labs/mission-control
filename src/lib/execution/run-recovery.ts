/**
 * Execution State Recovery
 *
 * Detects and recovers from interrupted execution runs after a server restart
 * or crash. Two passes:
 *
 * 1. recoverInterruptedRuns() — marks execution_runs rows that were stuck in
 *    'running' status past a stale threshold as 'interrupted'.
 *
 * 2. recoverPendingDispatches() — finds tasks still in 'in_progress' status
 *    that no longer have an active run, and resets them to 'assigned' so the
 *    scheduler can re-dispatch them.
 *
 * Both functions are idempotent and safe to call at startup.
 * Idempotency for runs is guaranteed by the unique run_key constraint.
 */

import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { logExecutionEvent } from './execution-logger'
import { getIncompleteRuns, updateRunStatus } from './replay/replay-loader'

const DEFAULT_STALE_THRESHOLD_SEC = 600  // 10 minutes

/**
 * Mark stale 'running' execution_runs as 'interrupted'.
 * Returns the number of runs marked.
 */
export function recoverInterruptedRuns(
  workspaceId: number,
  staleThresholdSec = DEFAULT_STALE_THRESHOLD_SEC,
): number {
  try {
    const stale = getIncompleteRuns(workspaceId, staleThresholdSec)
    for (const run of stale) {
      updateRunStatus(run.id, 'interrupted', {
        error_code: 'INTERRUPTED',
        error_message: 'Run interrupted: server restarted or process crashed',
      })
      logExecutionEvent({
        event_type: 'run_interrupted',
        workspace_id: workspaceId,
        run_id: run.id,
        task_id: run.task_id,
        detail: { run_key: run.run_key, started_at: run.started_at },
      })
    }
    if (stale.length > 0) {
      logger.info({ count: stale.length, workspaceId }, 'Marked stale execution runs as interrupted')
    }
    return stale.length
  } catch (err) {
    logger.warn({ err, workspaceId }, 'recoverInterruptedRuns: unexpected error')
    return 0
  }
}

/**
 * Reset tasks stuck in 'in_progress' with no active execution_run back to
 * 'assigned' so the scheduler can re-dispatch them.
 * Returns the number of tasks reset.
 */
export function recoverPendingDispatches(
  workspaceId: number,
  staleThresholdSec = DEFAULT_STALE_THRESHOLD_SEC,
): number {
  try {
    const db = getDatabase()
    const cutoff = Math.floor(Date.now() / 1000) - staleThresholdSec

    // Tasks that are in_progress but have no corresponding active run
    const stuckTasks = db.prepare(`
      SELECT t.id, t.title, t.updated_at
      FROM tasks t
      WHERE t.workspace_id = ?
        AND t.status = 'in_progress'
        AND t.updated_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM execution_runs r
          WHERE r.task_id = t.id
            AND r.workspace_id = t.workspace_id
            AND r.status = 'running'
        )
    `).all(workspaceId, cutoff) as Array<{ id: number; title: string; updated_at: number }>

    if (stuckTasks.length === 0) return 0

    const now = Math.floor(Date.now() / 1000)
    for (const task of stuckTasks) {
      db.prepare(`
        UPDATE tasks SET status = 'assigned', updated_at = ? WHERE id = ? AND workspace_id = ?
      `).run(now, task.id, workspaceId)

      logExecutionEvent({
        event_type: 'run_recovered',
        workspace_id: workspaceId,
        task_id: task.id,
        detail: { title: task.title, previous_status: 'in_progress', recovery: 'reset_to_assigned' },
      })
    }

    logger.info(
      { count: stuckTasks.length, workspaceId },
      'Recovered stuck in_progress tasks to assigned',
    )
    return stuckTasks.length
  } catch (err) {
    logger.warn({ err, workspaceId }, 'recoverPendingDispatches: unexpected error')
    return 0
  }
}
