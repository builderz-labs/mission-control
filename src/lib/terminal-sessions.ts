import { normalizeCliKind } from './cli-session-kinds'
import type { DashboardSession } from './dashboard-cli-fleets'

/** Terminal tabs are capped so a 650-session host still renders a usable strip. */
export const TERMINAL_TAB_LIMIT = 24

export function terminalTabId(session: DashboardSession): string {
  return `${session.source || 'local'}:${normalizeCliKind(session.kind)}:${session.id}`
}

function recency(session: DashboardSession): number {
  return session.lastActivity ?? session.startTime ?? 0
}

/**
 * Live sessions first, then most recently active, so the terminal opens on
 * whatever is actually running rather than on an arbitrary list position.
 */
export function orderTerminalSessions(
  sessions: DashboardSession[],
  limit = TERMINAL_TAB_LIMIT,
): DashboardSession[] {
  return [...sessions]
    .sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1
      return recency(b) - recency(a)
    })
    .slice(0, Math.max(0, limit))
}
