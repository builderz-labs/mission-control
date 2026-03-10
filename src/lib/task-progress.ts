type TaskLike = {
  status: string
  created_at: number
  updated_at: number
  estimated_hours?: number | null
  actual_hours?: number | null
  metadata?: any
}

const STATUS_BASELINE: Record<string, number> = {
  inbox: 5,
  assigned: 20,
  in_progress: 35,
  review: 75,
  quality_review: 90,
  done: 100,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toMetadataObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function getTaskStartedAt(task: TaskLike) {
  const metadata = toMetadataObject(task.metadata)
  const explicit = Number(metadata.started_at)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  if (task.status === 'in_progress' || task.status === 'review' || task.status === 'quality_review' || task.status === 'done') {
    return task.updated_at || task.created_at
  }
  return task.created_at
}

export function computeTaskProgress(task: TaskLike) {
  const baseline = STATUS_BASELINE[task.status] ?? 10
  if (task.status === 'done') return 100
  if (task.status === 'review') return 75
  if (task.status === 'quality_review') return 90
  if (task.status === 'assigned') return 20
  if (task.status === 'inbox') return 5

  const metadata = toMetadataObject(task.metadata)
  const explicitProgress = Number(metadata.progress_pct)
  if (Number.isFinite(explicitProgress) && explicitProgress > 0) {
    return clamp(Math.round(explicitProgress), baseline, 95)
  }

  const startedAt = getTaskStartedAt(task)
  const elapsedHours = Math.max(0, (Date.now() / 1000 - startedAt) / 3600)

  if (task.estimated_hours && task.estimated_hours > 0) {
    const timePct = clamp((elapsedHours / task.estimated_hours) * 100, 0, 100)
    const actualPct = task.actual_hours && task.actual_hours > 0
      ? clamp((task.actual_hours / task.estimated_hours) * 100, 0, 100)
      : 0
    const inferred = baseline + Math.max(timePct, actualPct) * 0.45
    return clamp(Math.round(inferred), baseline, 95)
  }

  return clamp(Math.round(baseline + elapsedHours * 8), baseline, 88)
}

export function formatTaskTimeRemaining(task: TaskLike) {
  if (task.status === 'done') return 'Completed'

  const progress = computeTaskProgress(task)
  const startedAt = getTaskStartedAt(task)
  const elapsedMs = Math.max(0, Date.now() - startedAt * 1000)

  if (progress <= 0 || elapsedMs <= 0) return 'Unknown'
  if (progress >= 100) return 'Completed'

  const remainingMs = elapsedMs * ((100 - progress) / progress)
  const remainingMinutes = remainingMs / (1000 * 60)

  if (remainingMinutes < 60) return `${Math.max(1, Math.round(remainingMinutes))} mins remaining`
  if (remainingMinutes < 24 * 60) return `${(remainingMinutes / 60).toFixed(1)} hrs remaining`
  return `${Math.ceil(remainingMinutes / (24 * 60))} days remaining`
}

export function mergeTaskProgressMetadata(task: TaskLike, nextStatus: string | undefined, now: number, incomingMetadata?: unknown) {
  const existing = toMetadataObject(task.metadata)
  const incoming = toMetadataObject(incomingMetadata)
  const merged: Record<string, unknown> = { ...existing, ...incoming }
  const resolvedStatus = nextStatus || task.status

  if ((resolvedStatus === 'in_progress' || resolvedStatus === 'review' || resolvedStatus === 'quality_review' || resolvedStatus === 'done') && !Number.isFinite(Number(merged.started_at))) {
    merged.started_at = existing.started_at || now
  }

  if (resolvedStatus !== task.status) {
    merged.stage_started_at = now
  }

  const baseline = STATUS_BASELINE[resolvedStatus]
  if (baseline != null) {
    const currentProgress = Number(merged.progress_pct)
    merged.progress_pct = Number.isFinite(currentProgress)
      ? clamp(currentProgress, baseline, 100)
      : baseline
  }

  if (resolvedStatus === 'done') {
    merged.completed_at = now
    merged.progress_pct = 100
  }

  return merged
}
