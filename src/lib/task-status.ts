import type { Task } from './db'
import type { TaskLifecycleStatus } from './task-harness'

export type TaskStatus = Task['status']
export type TaskOutcome = NonNullable<Task['outcome']>

function hasAssignee(assignedTo: string | null | undefined): boolean {
  return Boolean(assignedTo && assignedTo.trim())
}

function isTerminalFailureOutcome(outcome: TaskOutcome | undefined): boolean {
  return outcome === 'failed' || outcome === 'partial' || outcome === 'abandoned'
}

/**
 * Keep task state coherent when a task is created with an assignee.
 * If caller asks for `inbox` but also sets `assigned_to`, normalize to `assigned`.
 */
export function normalizeTaskCreateStatus(
  requestedStatus: TaskStatus | undefined,
  assignedTo: string | undefined
): TaskStatus {
  const status = requestedStatus ?? 'inbox'
  if (status === 'inbox' && hasAssignee(assignedTo)) return 'assigned'
  return status
}

/**
 * `awaiting_owner` is reserved for actionable human follow-up, not terminal
 * failures that should surface in the failed queue.
 */
export function normalizeTaskStatusForOutcome(
  status: TaskStatus,
  outcome: TaskOutcome | undefined
): TaskStatus {
  if ((status === 'awaiting_owner' || status === 'needs_owner' || status === 'owner_gate_review') && isTerminalFailureOutcome(outcome)) {
    return 'failed_terminal'
  }
  return status
}

/**
 * Auto-adjust status for assignment-only updates when caller does not
 * explicitly request a status transition.
 */
export function normalizeTaskUpdateStatus(args: {
  currentStatus: TaskStatus
  requestedStatus: TaskStatus | undefined
  assignedTo: string | null | undefined
  assignedToProvided: boolean
}): TaskStatus | undefined {
  const { currentStatus, requestedStatus, assignedTo, assignedToProvided } = args
  if (requestedStatus !== undefined) return requestedStatus
  if (!assignedToProvided) return undefined

  if (hasAssignee(assignedTo) && currentStatus === 'inbox') return 'assigned'
  if (!hasAssignee(assignedTo) && currentStatus === 'assigned') return 'inbox'
  return undefined
}

export function isActiveTaskStatus(status: TaskLifecycleStatus): boolean {
  return ['assigned', 'preflight', 'ready', 'in_progress', 'recovering', 'degraded_execution'].includes(status)
}
