import type { Task } from './db'

export type TaskStatus = Task['status']

function hasAssignee(assignedTo: string | null | undefined): boolean {
  return Boolean(assignedTo && assignedTo.trim())
}

/**
 * Resolve the effective assignee for a newly-created task (issue #663).
 * Uses the explicit assignee when provided; otherwise falls back to the
 * configured coordinator agent (auto-routing). Returns null when neither is
 * set, so unassigned tasks stay unassigned when the coordinator is not
 * configured. The coordinator value is opt-in (empty string disables it).
 */
export function resolveTaskAssignee(
  requestedAssignee: string | null | undefined,
  coordinatorAgent: string | null | undefined
): string | null {
  if (hasAssignee(requestedAssignee)) return (requestedAssignee as string).trim()
  if (hasAssignee(coordinatorAgent)) return (coordinatorAgent as string).trim()
  return null
}

/**
 * Keep task state coherent when a task is created with an assignee.
 * If caller asks for `inbox` but also sets `assigned_to`, normalize to `assigned`.
 */
export function normalizeTaskCreateStatus(
  requestedStatus: TaskStatus | undefined,
  assignedTo: string | null | undefined
): TaskStatus {
  const status = requestedStatus ?? 'inbox'
  if (status === 'inbox' && hasAssignee(assignedTo)) return 'assigned'
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

