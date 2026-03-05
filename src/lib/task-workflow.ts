export const OFFICE_TASK_STATUSES = [
  'inbox',
  'backlog',
  'todo',
  'in-progress',
  'review',
  'blocked',
  'needs-approval',
  'done',
] as const

export type OfficeTaskStatus = (typeof OFFICE_TASK_STATUSES)[number]

const LEGACY_STATUS_MAP: Record<string, OfficeTaskStatus> = {
  assigned: 'todo',
  in_progress: 'in-progress',
  quality_review: 'review',
  needs_approval: 'needs-approval',
}

const VALID_STATUS_SET = new Set<string>(OFFICE_TASK_STATUSES)

export function normalizeTaskStatus(input: string | undefined | null): OfficeTaskStatus {
  const raw = String(input || 'inbox').trim().toLowerCase()
  if (VALID_STATUS_SET.has(raw)) return raw as OfficeTaskStatus
  if (LEGACY_STATUS_MAP[raw]) return LEGACY_STATUS_MAP[raw]
  return 'inbox'
}

export function isMainTask(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const data = metadata as Record<string, unknown>
  return data.scope === 'main' || data.isMainTask === true
}

export function requiresExternalApproval(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const data = metadata as Record<string, unknown>

  if (data.requiresExternalApproval === true) return true

  const actionType = String(data.actionType || '').toLowerCase()
  return ['publish', 'email', 'webhook', 'external_call', 'external-call'].includes(actionType)
}

export function shouldRequireApprovalForDone(
  previousStatus: string,
  nextStatus: string,
  metadata: unknown,
): boolean {
  const prev = normalizeTaskStatus(previousStatus)
  const next = normalizeTaskStatus(nextStatus)
  if (next !== 'done') return false

  // Main task needs explicit approval for review -> done
  if (prev === 'review' && isMainTask(metadata)) return true

  // Any task requiring external execution approval must be approved before done
  if (requiresExternalApproval(metadata)) return true

  return false
}
