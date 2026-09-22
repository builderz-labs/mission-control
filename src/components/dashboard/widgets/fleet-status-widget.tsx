'use client'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import type { CliFleet } from '@/lib/dashboard-cli-fleets'
import type { DashboardData } from '../widget-primitives'

function Sparkline({ data, color = 'currentColor' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <span className="w-14 h-5 inline-block" />
  const h = 20
  const w = 56
  const max = Math.max(...data, 1)
  const step = w / (data.length - 1)
  const points = data.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-14 h-5 inline-block" preserveAspectRatio="none">
      <polygon points={`0,${h} ${points} ${w},${h}`} fill={color} opacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getSessionSparkline(sessions: CliFleet['sessions']): number[] {
  const now = Date.now()
  const bins = 7
  const binWidth = (24 * 60 * 60 * 1000) / bins
  const counts = new Array(bins).fill(0)
  for (const session of sessions) {
    const ts = session.lastActivity || session.startTime || 0
    if (!ts) continue
    const age = now - ts
    if (age > 24 * 60 * 60 * 1000) continue
    const bin = Math.min(bins - 1, Math.floor(age / binWidth))
    counts[bins - 1 - bin] += 1
  }
  return counts
}

export function FleetStatusWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    cliFleets,
    connection,
    isSessionsLoading,
    sessions,
    onlineAgents,
    dbStats,
    agents,
    navigateToPanel,
  } = data

  const gatewayRow: CliFleet = {
    kind: 'gateway',
    label: 'Gateway',
    color: 'text-emerald-400',
    sparkColor: '#34d399',
    active: onlineAgents,
    total: dbStats?.agents.total ?? agents.length,
    sessions,
    cost: null,
    health: { value: `${onlineAgents} online`, status: connection.isConnected ? 'good' : 'bad' },
  }
  const cliRows = cliFleets.filter((fleet) => fleet.kind !== 'gateway')
  const rows: CliFleet[] = isLocal
    ? cliRows
    : [gatewayRow, ...cliRows.filter((fleet) => fleet.total > 0)]

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Fleet Status</h3>
      </div>
      <div className="divide-y divide-border/30">
        {rows.map((row) => {
          const ratio = row.total > 0 ? row.active / row.total : 0
          return (
            <div
              key={row.kind}
              onClick={() => navigateToPanel(row.kind === 'gateway' ? 'agents' : 'sessions')}
              className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-secondary/30 transition-smooth"
            >
              <span className={`text-xs font-semibold w-20 shrink-0 ${row.color} flex items-center gap-1.5`}>
                <AgentAvatar name={row.label} size="xs" />
                {row.label}
              </span>
              <span className="text-xs text-foreground/80 w-20 shrink-0 font-mono-tight">
                {isSessionsLoading ? '...' : `${row.active} active`}
              </span>
              <Sparkline data={getSessionSparkline(row.sessions)} color={row.sparkColor} />
              <span className="text-2xs text-muted-foreground w-16 shrink-0 font-mono-tight">
                {isSessionsLoading ? '' : `${row.total} total`}
              </span>
              <span className="text-2xs text-muted-foreground w-20 shrink-0 font-mono-tight text-right hidden sm:block">
                {row.cost != null ? `$${row.cost.toFixed(2)}` : ''}
              </span>
              {!isSessionsLoading && row.total > 0 && (
                <span className="hidden lg:inline-flex h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                  <span
                    className={`h-full rounded-full transition-all duration-500 ${ratio > 0.8 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
