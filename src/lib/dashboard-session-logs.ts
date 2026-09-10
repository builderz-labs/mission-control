import { normalizeCliKind } from './cli-session-kinds'
import type { DashboardSession } from './dashboard-cli-fleets'

export interface SessionLogLike {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

const SOURCE_BY_KIND: Record<string, string> = {
  'codex-cli': 'codex-local',
  hermes: 'hermes-local',
  grok: 'grok-local',
  kimi: 'kimi-local',
  opencode: 'opencode-local',
  gateway: 'gateway',
}

export function sessionLogSource(kind: string | undefined): string {
  return SOURCE_BY_KIND[normalizeCliKind(kind)] ?? 'claude-local'
}

export function localSessionLogs(sessions: DashboardSession[]): SessionLogLike[] {
  const logs: SessionLogLike[] = []
  for (const session of sessions) {
    const ts = session.lastActivity || session.startTime || 0
    if (!ts) continue
    const lastPrompt = typeof session.lastUserPrompt === 'string' ? session.lastUserPrompt.trim() : ''
    logs.push({
      id: `local-session-${session.id}-${ts}`,
      timestamp: ts,
      level: 'info',
      source: sessionLogSource(session.kind),
      message: lastPrompt
        ? `Prompt: ${lastPrompt}`
        : `${session.active ? 'Active' : 'Idle'} session: ${session.key || session.id}`,
    })
  }
  return logs
}

export function mergeRecentLogs(logs: SessionLogLike[], extras: SessionLogLike[], limit = 10): SessionLogLike[] {
  return [...logs, ...extras]
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((entry, index, arr) => arr.findIndex((item) => item.id === entry.id) === index)
    .slice(0, limit)
}
