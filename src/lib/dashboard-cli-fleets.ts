import {
  CLI_SESSION_KINDS,
  cliKindMeta,
  normalizeCliKind,
  type CliKindMeta,
} from './cli-session-kinds'

export interface DashboardSession {
  id: string
  key?: string
  agent?: string
  kind?: string
  model?: string
  tokens?: string
  age?: string
  active?: boolean
  startTime?: number
  lastActivity?: number
  lastUserPrompt?: string | null
  title?: string | null
  project?: string
  environment?: string
  workingDir?: string | null
  source?: 'local' | 'gateway'
  channel?: string
}

export interface CliFleet extends CliKindMeta {
  active: number
  total: number
  sessions: DashboardSession[]
  cost: number | null
  health: { value: string; status: 'good' | 'warn' | 'bad' }
}

export type FleetTotals = Partial<Record<string, { total?: number; active?: number; cost?: number | null }>>

export function providerHealth(active: number, total: number): { value: string; status: 'good' | 'warn' | 'bad' } {
  if (total === 0) return { value: 'No sessions', status: 'warn' }
  if (active > 0) return { value: `${active} active`, status: 'good' }
  return { value: `Idle (${total})`, status: 'warn' }
}

export function groupSessionsByKind(sessions: DashboardSession[]): Map<string, DashboardSession[]> {
  const grouped = new Map<string, DashboardSession[]>()
  for (const session of sessions) {
    const kind = normalizeCliKind(session.kind)
    const list = grouped.get(kind)
    if (list) list.push(session)
    else grouped.set(kind, [session])
  }
  return grouped
}

function fleetFromSessions(
  kind: string,
  sessions: DashboardSession[],
  totals?: FleetTotals[string],
): CliFleet {
  const meta = cliKindMeta(kind)
  const total = totals?.total ?? sessions.length
  const active = totals?.active ?? sessions.filter((session) => session.active).length
  return {
    ...meta,
    sessions,
    total,
    active,
    cost: totals?.cost ?? null,
    health: providerHealth(active, total),
  }
}

export function buildCliFleets(sessions: DashboardSession[], totals: FleetTotals = {}): CliFleet[] {
  const grouped = groupSessionsByKind(sessions)
  const fleets = CLI_SESSION_KINDS.map((kind) => fleetFromSessions(kind, grouped.get(kind) ?? [], totals[kind]))
  const leftover = grouped.get('gateway') ?? []
  if (leftover.length > 0 || totals.gateway) {
    fleets.push(fleetFromSessions('gateway', leftover, totals.gateway))
  }
  return fleets
}

export function filterSessionsByKind(
  sessions: DashboardSession[],
  kindFilter: 'all' | 'active' | string,
): DashboardSession[] {
  if (kindFilter === 'all') return sessions
  if (kindFilter === 'active') return sessions.filter((session) => session.active)
  return sessions.filter((session) => normalizeCliKind(session.kind) === kindFilter)
}
