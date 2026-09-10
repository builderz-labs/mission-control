import { getAllGatewaySessions } from '@/lib/sessions'
import { getLocalGrokSessions, getLocalKimiSessions } from '@/lib/local-engine-sessions'
import { formatAge, formatTokens } from '@/lib/session-list-format'
import {
  getLocalClaudeSessions,
  getLocalCodexSessions,
  getLocalHermesSessions,
  getLocalOpenCodeSessions,
  type SessionListItem,
} from '@/lib/session-list-local'
import { ttlGet } from '@/lib/session-ttl-cache'

const SCAN_TTL_MS = 2500

export function mapGatewaySessions(gatewaySessions: ReturnType<typeof getAllGatewaySessions>): SessionListItem[] {
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
    return {
      id: s.sessionId || `${s.agent}:${s.key}`,
      key: s.key,
      agent: s.agent,
      kind: s.chatType || 'unknown',
      age: formatAge(s.updatedAt),
      model: s.model,
      tokens: `${formatTokens(totalTokens)}/${formatTokens(context)} (${pct}%)`,
      channel: s.channel,
      flags: [],
      active: s.active,
      startTime: s.updatedAt,
      lastActivity: s.updatedAt,
      source: 'gateway',
    }
  })
}

export function collectLocalSessions(): SessionListItem[] {
  return [
    ...getLocalClaudeSessions(),
    ...getLocalCodexSessions(),
    ...getLocalHermesSessions(),
    ...getLocalOpenCodeSessions(),
    ...ttlGet('grok-sessions', SCAN_TTL_MS, getLocalGrokSessions) as SessionListItem[],
    ...ttlGet('kimi-sessions', SCAN_TTL_MS, getLocalKimiSessions) as SessionListItem[],
  ]
}
