/**
 * Helpers for agent card display — extracted for testability.
 */

/** Strip provider prefix from model ID: "anthropic/claude-opus-4-5" → "claude-opus-4-5" */
export function formatModelName(config: Record<string, unknown> | null | undefined): string | null {
  const modelField = config?.model && typeof config.model === 'object'
    ? (config.model as Record<string, unknown>)
    : null
  const raw = modelField?.primary
  const primary = typeof raw === 'string'
    ? raw
    : (raw && typeof raw === 'object' ? (raw as Record<string, unknown>).primary : null)
  if (!primary || typeof primary !== 'string') return null
  const parts = primary.split('/')
  return parts[parts.length - 1]
}

export interface TaskStats {
  total: number
  assigned: number
  in_progress: number
  quality_review: number
  done: number
  completed: number
}

export interface TaskStatPart {
  label: string
  count: number
  color?: string
}

/** Build inline task stat parts from agent taskStats, omitting zero counts. */
export function buildTaskStatParts(stats: TaskStats | undefined | null): TaskStatPart[] | null {
  if (!stats) return null
  const parts: TaskStatPart[] = []
  if (stats.assigned) parts.push({ label: 'assigned', count: stats.assigned })
  if (stats.in_progress) parts.push({ label: 'active', count: stats.in_progress, color: 'text-amber-300' })
  if (stats.quality_review) parts.push({ label: 'review', count: stats.quality_review, color: 'text-violet-300' })
  if (stats.done) parts.push({ label: 'done', count: stats.done, color: 'text-emerald-300' })
  return parts.length > 0 ? parts : null
}

/** Extract WebSocket host from connection URL for tooltip display. */
export function extractWsHost(url: string | undefined): string {
  if (!url) return '—'
  try {
    return new URL(url.replace(/^ws/, 'http')).host
  } catch {
    return '—'
  }
}
