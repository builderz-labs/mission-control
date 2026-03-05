import { getDatabase } from './db'

export type TaskApprovalAction = 'approve' | 'reject'

export interface LatestTaskApproval {
  id: number
  task_id: number
  action: TaskApprovalAction
  summary: string
  rationale?: string | null
  actor: string
  created_at: number
}

export function getLatestTaskApproval(taskId: number): LatestTaskApproval | null {
  const db = getDatabase()
  return (
    (db
      .prepare(
        `SELECT id, task_id, action, summary, rationale, actor, created_at
         FROM task_approvals
         WHERE task_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(taskId) as LatestTaskApproval | undefined) || null
  )
}

export function hasApprovedTask(taskId: number): boolean {
  const latest = getLatestTaskApproval(taskId)
  return latest?.action === 'approve'
}
