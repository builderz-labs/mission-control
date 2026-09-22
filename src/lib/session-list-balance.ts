import { CLI_SESSION_KINDS } from './cli-session-kinds'

const PER_CLI_KIND = 40
export const TOTAL_LIMIT = 120
export const ABSOLUTE_LIMIT = 2000

export function parseSessionLimit(raw: string | null): number {
  if (raw == null || raw === '') return TOTAL_LIMIT
  if (raw === 'all') return ABSOLUTE_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return TOTAL_LIMIT
  return Math.min(Math.floor(parsed), ABSOLUTE_LIMIT)
}

export function takeBalancedSessions(
  sessions: Array<Record<string, unknown>>,
  limit = TOTAL_LIMIT,
): Array<Record<string, unknown>> {
  const sorted = [...sessions].sort(
    (a, b) => Number(b?.lastActivity || 0) - Number(a?.lastActivity || 0),
  )
  const picked: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  const keyOf = (session: Record<string, unknown>) => `${session.source || ''}:${session.id || ''}`
  const perKind = Math.max(1, Math.min(PER_CLI_KIND, Math.floor(limit / CLI_SESSION_KINDS.length) || 1))

  for (const kind of CLI_SESSION_KINDS) {
    if (picked.length >= limit) break
    let count = 0
    for (const session of sorted) {
      if (session.kind !== kind) continue
      const key = keyOf(session)
      if (!session.id || seen.has(key)) continue
      picked.push(session)
      seen.add(key)
      count += 1
      if (count >= perKind || picked.length >= limit) break
    }
  }

  for (const session of sorted) {
    if (picked.length >= limit) break
    const key = keyOf(session)
    if (!session.id || seen.has(key)) continue
    picked.push(session)
    seen.add(key)
  }

  return picked.sort(
    (a, b) => Number(b?.lastActivity || 0) - Number(a?.lastActivity || 0),
  )
}

export function dedupeAndSortSessions(
  merged: Array<Record<string, unknown>>,
  limit = TOTAL_LIMIT,
): Array<Record<string, unknown>> {
  const deduped = new Map<string, Record<string, unknown>>()
  for (const session of merged) {
    const id = String(session?.id || '')
    const source = String(session?.source || '')
    const key = `${source}:${id}`
    if (!id) continue
    const existing = deduped.get(key)
    const currentActivity = Number(session?.lastActivity || 0)
    const existingActivity = Number(existing?.lastActivity || 0)
    if (!existing || currentActivity > existingActivity) deduped.set(key, session)
  }
  return takeBalancedSessions(Array.from(deduped.values()), limit)
}
