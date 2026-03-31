export type OfficeFeedSeverity = 'info' | 'warn' | 'good'
export type OfficeFeedKind = 'action' | 'room' | 'desk'

export interface OfficeFeedEvent {
  id: string
  kind: OfficeFeedKind
  severity: OfficeFeedSeverity
  message: string
  at: number
}

export interface OfficeFeedActivity {
  id: number
  type: string
  actor: string
  description: string
  created_at: number
  data?: Record<string, unknown> | null
  entity?: {
    id?: number
    name?: string
    status?: string
    type?: string
  } | null
}

export interface OfficeFeedStatusSnapshot {
  id: number
  name: string
  zoneLabel: string
  status: 'idle' | 'busy' | 'error' | 'offline'
}

export interface OfficeFeedRuntimeTask {
  id: number
  title: string
  status: string
  updated_at?: number
  created_by?: string | null
  tags?: string[] | null
  metadata?: Record<string, unknown> | null
}

export interface OfficeFeedCronJob {
  id?: string
  name: string
  lastRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
  nextRun?: number
}

function severityFromActivityType(type: string): OfficeFeedSeverity {
  const normalized = String(type || '').trim().toLowerCase()
  if (/(completed|done|success|resolved|published|reserved)/.test(normalized)) return 'good'
  if (/(failed|error|blocked|alert|warning)/.test(normalized)) return 'warn'
  return 'info'
}

function statusLabel(status: OfficeFeedStatusSnapshot['status']): string {
  if (status === 'busy') return 'active'
  if (status === 'idle') return 'standby'
  if (status === 'error') return 'alert'
  return 'offline'
}

function normalizeActivityDescription(activity: OfficeFeedActivity): string {
  const description = String(activity.description || '').trim()
  if (description) return description

  const type = String(activity.type || '').trim().toLowerCase()
  const actor = String(activity.actor || '').trim()
  const entityName = String(activity.entity?.name || '').trim()
  const rawStatus = activity.data && typeof activity.data === 'object'
    ? String((activity.data as Record<string, unknown>).status || '').trim().toLowerCase()
    : ''

  if (type === 'agent_status_change') {
    if (entityName && rawStatus) return `${entityName} changed to ${rawStatus}`
    if (entityName) return `${entityName} heartbeat updated`
    if (actor === 'heartbeat') return ''
  }

  return ''
}

export function mapActivitiesToOfficeEvents(activities: OfficeFeedActivity[]): OfficeFeedEvent[] {
  return activities.flatMap((activity) => {
    const description = normalizeActivityDescription(activity)
    if (!description) return []
    return [{
      id: `activity-${activity.id}`,
      kind: 'action' as const,
      severity: severityFromActivityType(activity.type),
      message: `${activity.actor}: ${description}`,
      at: activity.created_at * 1000,
    }]
  })
}

function severityFromTaskStatus(status: string): OfficeFeedSeverity {
  const normalized = String(status || '').trim().toLowerCase()
  if (/(done|completed|success)/.test(normalized)) return 'good'
  if (/(review|blocked|error|failed|attention)/.test(normalized)) return 'warn'
  return 'info'
}

function taskStatusLabel(status: string): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'done') return 'completed'
  if (normalized === 'review') return 'needs review'
  if (normalized === 'in_progress') return 'in progress'
  if (normalized === 'todo') return 'queued'
  return normalized || 'updated'
}

function isRuntimeTask(task: OfficeFeedRuntimeTask): boolean {
  const metadata = task.metadata || {}
  if (metadata.runtimeDerived === true) return true
  if (task.created_by === 'runtime-sync') return true
  if (Array.isArray(task.tags) && task.tags.includes('runtime')) return true
  return task.id < 0
}

export function buildRuntimeTaskEvents(tasks: OfficeFeedRuntimeTask[]): OfficeFeedEvent[] {
  return tasks
    .filter(isRuntimeTask)
    .filter((task) => Number(task.updated_at || 0) > 0)
    .map((task) => ({
      id: `runtime-task-${task.id}-${task.updated_at}-${task.status}`,
      kind: 'desk' as const,
      severity: severityFromTaskStatus(task.status),
      message: `${task.title}: ${taskStatusLabel(task.status)}.`,
      at: Number(task.updated_at) * 1000,
    }))
}

function severityFromCronStatus(status?: string): OfficeFeedSeverity {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'success') return 'good'
  if (normalized === 'error') return 'warn'
  return 'info'
}

function cronStatusLabel(status?: string): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'success') return 'completed'
  if (normalized === 'error') return 'failed'
  if (normalized === 'running') return 'running'
  return normalized || 'scheduled'
}

export function buildCronJobEvents(jobs: OfficeFeedCronJob[]): OfficeFeedEvent[] {
  return jobs.flatMap((job) => {
    const at = Number(job.lastRun || 0)
    if (!at) return []
    const label = cronStatusLabel(job.lastStatus)
    const errorSuffix = job.lastStatus === 'error' && job.lastError
      ? ` (${String(job.lastError).slice(0, 120)})`
      : ''
    return [{
      id: `cron-${job.id || job.name}-${at}-${job.lastStatus || 'scheduled'}`,
      kind: 'room' as const,
      severity: severityFromCronStatus(job.lastStatus),
      message: `${job.name}: ${label}.${errorSuffix}`,
      at,
    }]
  })
}

export function buildStatusTransitionEvents(
  previousStatuses: Map<number, OfficeFeedStatusSnapshot['status']>,
  currentSnapshots: OfficeFeedStatusSnapshot[],
  nowMs: number
): OfficeFeedEvent[] {
  return currentSnapshots.flatMap((snapshot) => {
    const previous = previousStatuses.get(snapshot.id)
    if (!previous || previous === snapshot.status) return []

    return [{
      id: `status-${snapshot.id}-${snapshot.status}-${nowMs}`,
      kind: 'room' as const,
      severity: snapshot.status === 'busy' ? 'good' : snapshot.status === 'error' ? 'warn' : 'info',
      message: `${snapshot.zoneLabel}: ${snapshot.name} status changed to ${statusLabel(snapshot.status)}.`,
      at: nowMs,
    }]
  })
}

export function mergeOfficeEvents(
  existing: OfficeFeedEvent[],
  incoming: OfficeFeedEvent[],
  limit = 12
): OfficeFeedEvent[] {
  const merged = new Map<string, OfficeFeedEvent>()
  for (const event of [...incoming, ...existing]) {
    merged.set(event.id, event)
  }

  return Array.from(merged.values())
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}
