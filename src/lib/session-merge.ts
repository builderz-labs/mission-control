import { getAllGatewaySessions } from '@/lib/sessions'
import { attachProject, fleetAgentForSession, sessionEnvironment } from '@/lib/session-record'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export function mapGatewaySessions(gatewaySessions: ReturnType<typeof getAllGatewaySessions>) {
  const sessionMap = new Map<string, (typeof gatewaySessions)[0]>()
  for (const s of gatewaySessions) {
    const id = s.sessionId || `${s.agent}:${s.key}`
    const existing = sessionMap.get(id)
    if (!existing || s.updatedAt > existing.updatedAt) sessionMap.set(id, s)
  }
  return Array.from(sessionMap.values()).map((s) => {
    const totalTokens = s.totalTokens || 0
    const context = s.contextTokens || 35000
    const pct = context > 0 ? Math.round((totalTokens / context) * 100) : 0
    const id = s.sessionId || `${s.agent}:${s.key}`
    const project = attachProject(null)
    return {
      id,
      key: s.key,
      agent: fleetAgentForSession({ kind: s.chatType, sessionId: id, workingDir: null, gatewayAgent: s.agent }),
      kind: s.chatType || 'unknown',
      project: project.project,
      projectSlug: project.projectSlug,
      environment: sessionEnvironment({ source: 'gateway', workingDir: null }),
      age: formatAge(s.updatedAt),
      model: s.model,
      tokens: `${formatTokens(totalTokens)}/${formatTokens(context)} (${pct}%)`,
      channel: s.channel,
      flags: [] as string[],
      active: s.active,
      startTime: s.updatedAt,
      lastActivity: s.updatedAt,
      source: 'gateway' as const,
      workingDir: null,
      lastUserPrompt: null,
    }
  })
}

export function dedupeAndSortSessions<T extends { id?: unknown; source?: unknown; lastActivity?: unknown }>(
  merged: T[],
): T[] {
  const deduped = new Map<string, T>()
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
  return Array.from(deduped.values())
    .sort((a, b) => Number(b?.lastActivity || 0) - Number(a?.lastActivity || 0))
    .slice(0, 400)
}
