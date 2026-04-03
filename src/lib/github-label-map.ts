/**
 * Bidirectional mapping between Mission Control statuses/priorities and GitHub labels.
 * Labels use `mc:` prefix to avoid collisions with existing repo labels.
 */

export type TaskStatus = 'backlog' | 'inbox' | 'assigned' | 'awaiting_owner' | 'in_progress' | 'review' | 'quality_review' | 'done' | 'failed'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

interface LabelDef {
  name: string
  color: string
  description?: string
}

// ── Status ↔ Label mapping ──────────────────────────────────────

const STATUS_LABEL_MAP: Record<TaskStatus, LabelDef> = {
  backlog:        { name: 'mc:backlog',        color: '94a3b8', description: 'Mission Control: backlog' },
  inbox:          { name: 'mc:inbox',          color: '6b7280', description: 'Mission Control: inbox' },
  assigned:       { name: 'mc:assigned',       color: '3b82f6', description: 'Mission Control: assigned' },
  in_progress:    { name: 'mc:in-progress',    color: 'eab308', description: 'Mission Control: in progress' },
  review:         { name: 'mc:review',         color: 'a855f7', description: 'Mission Control: review' },
  quality_review: { name: 'mc:quality-review', color: '6366f1', description: 'Mission Control: quality review' },
  done:           { name: 'mc:done',           color: '22c55e', description: 'Mission Control: done' },
  awaiting_owner: { name: 'mc:awaiting-owner', color: 'f97316', description: 'Mission Control: awaiting owner' },
  failed:         { name: 'mc:failed',          color: 'ef4444', description: 'Mission Control: failed' },
}

const LABEL_STATUS_MAP: Record<string, TaskStatus> = Object.fromEntries(
  Object.entries(STATUS_LABEL_MAP).map(([status, def]) => [def.name, status as TaskStatus])
)

export function statusToLabel(status: TaskStatus): LabelDef {
  return STATUS_LABEL_MAP[status]
}

export function labelToStatus(labelName: string): TaskStatus | null {
  return LABEL_STATUS_MAP[labelName] ?? null
}

// ── Priority ↔ Label mapping ───────────────────────────────────

const PRIORITY_LABEL_MAP: Record<TaskPriority, LabelDef> = {
  critical: { name: 'priority:critical', color: 'ef4444', description: 'Priority: critical' },
  high:     { name: 'priority:high',     color: 'f97316', description: 'Priority: high' },
  medium:   { name: 'priority:medium',   color: 'eab308', description: 'Priority: medium' },
  low:      { name: 'priority:low',      color: '22c55e', description: 'Priority: low' },
}

const LABEL_PRIORITY_MAP: Record<string, TaskPriority> = Object.fromEntries(
  Object.entries(PRIORITY_LABEL_MAP).map(([priority, def]) => [def.name, priority as TaskPriority])
)

export function priorityToLabel(priority: TaskPriority): LabelDef {
  return PRIORITY_LABEL_MAP[priority] ?? PRIORITY_LABEL_MAP.medium
}

export function labelToPriority(labels: string[]): TaskPriority {
  for (const label of labels) {
    const p = LABEL_PRIORITY_MAP[label]
    if (p) return p
  }
  return 'medium'
}

// ── All MC labels (for initialization) ──────────────────────────

export const ALL_MC_LABELS: LabelDef[] = [
  ...Object.values(STATUS_LABEL_MAP),
  ...Object.values(PRIORITY_LABEL_MAP),
]

export const ALL_STATUS_LABEL_NAMES = Object.values(STATUS_LABEL_MAP).map(l => l.name)
export const ALL_PRIORITY_LABEL_NAMES = Object.values(PRIORITY_LABEL_MAP).map(l => l.name)
