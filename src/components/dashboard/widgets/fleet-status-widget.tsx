'use client'

import type { DashboardData } from '../widget-primitives'

/** Simple SVG sparkline from an array of numbers */
function Sparkline({ data, color = 'currentColor' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <span className="w-14 h-5 inline-block" />

  const h = 20
  const w = 56
  const max = Math.max(...data, 1)
  const step = w / (data.length - 1)

  const points = data.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(' ')
  // Area fill: same points but close the polygon at the bottom
  const areaPoints = `0,${h} ${points} ${w},${h}`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-14 h-5 inline-block" preserveAspectRatio="none">
      <polygon points={areaPoints} fill={color} opacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Derive sparkline data from sessions — bucket last 24h into 7 bins */
function getSessionSparkline(sessions: any[]): number[] {
  const now = Date.now()
  const bins = 7
  const binWidth = (24 * 60 * 60 * 1000) / bins
  const counts = new Array(bins).fill(0)

  for (const s of sessions) {
    const ts = s.lastActivity || s.startTime || 0
    if (!ts) continue
    const age = now - ts
    if (age > 24 * 60 * 60 * 1000) continue
    const bin = Math.min(bins - 1, Math.floor(age / binWidth))
    counts[bins - 1 - bin]++ // reverse so newest is rightmost
  }
  return counts
}

interface FleetRow {
  name: string
  active: number
  total: number
  sessions: any[]
  cost: number | null
  color: string
  sparkColor: string
  onClick?: () => void
}

export function FleetStatusWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    claudeActive,
    codexActive,
    hermesActive,
    claudeLocalSessions,
    codexLocalSessions,
    hermesLocalSessions,
    claudeStats,
    connection,
    isClaudeLoading,
    isSessionsLoading,
    sessions,
    onlineAgents,
    dbStats,
    agents,
    navigateToPanel,
  } = data

  const rows: FleetRow[] = isLocal
    ? [
        {
          name: 'Claude',
          active: claudeActive,
          total: claudeStats?.total_sessions ?? claudeLocalSessions.length,
          sessions: claudeLocalSessions,
          cost: claudeStats?.total_estimated_cost ?? null,
          color: 'text-blue-400',
          sparkColor: '#60a5fa',
          onClick: () => navigateToPanel('sessions'),
        },
        {
          name: 'Codex',
          active: codexActive,
          total: codexLocalSessions.length,
          sessions: codexLocalSessions,
          cost: null,
          color: 'text-green-400',
          sparkColor: '#4ade80',
          onClick: () => navigateToPanel('sessions'),
        },
        {
          name: 'Hermes',
          active: hermesActive,
          total: hermesLocalSessions.length,
          sessions: hermesLocalSessions,
          cost: null,
          color: 'text-purple-400',
          sparkColor: '#c084fc',
          onClick: () => navigateToPanel('sessions'),
        },
      ]
    : [
        {
          name: 'Gateway',
          active: onlineAgents,
          total: dbStats?.agents.total ?? agents.length,
          sessions: sessions,
          cost: null,
          color: 'text-emerald-400',
          sparkColor: '#34d399',
          onClick: () => navigateToPanel('agents'),
        },
      ]

  // Add gateway row for local mode too if connected
  if (isLocal && connection.isConnected) {
    rows.push({
      name: 'Gateway',
      active: 0,
      total: 0,
      sessions: [],
      cost: null,
      color: 'text-emerald-400',
      sparkColor: '#34d399',
    })
  }

  const isLoading = isClaudeLoading || isSessionsLoading

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Fleet Status</h3>
      </div>
      <div className="divide-y divide-border/30">
        {rows.map((row) => {
          const sparkData = getSessionSparkline(row.sessions)
          const isGateway = row.name === 'Gateway'

          const RowEl = row.onClick ? 'button' : 'div'
          return (
            <RowEl
              key={row.name}
              type={row.onClick ? 'button' : undefined}
              onClick={row.onClick}
              className={`w-full text-left border-0 bg-transparent px-4 py-3 flex items-center gap-4 ${
                row.onClick ? 'cursor-pointer hover:bg-secondary/30 transition-smooth' : ''
              }`}
            >
              {/* Name */}
              <span className={`text-xs font-semibold w-16 shrink-0 ${row.color}`}>
                {row.name}
              </span>

              {/* Active count */}
              <span className="text-xs text-foreground/80 w-20 shrink-0 font-mono-tight">
                {isGateway && isLocal ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-green-500" />
                    connected
                  </span>
                ) : isLoading ? (
                  '…'
                ) : (
                  <>{row.active} active</>
                )}
              </span>

              {/* Sparkline */}
              <Sparkline data={sparkData} color={row.sparkColor} />

              {/* Total */}
              <span className="text-2xs text-muted-foreground w-16 shrink-0 font-mono-tight">
                {isGateway && isLocal ? (
                  connection.latency != null ? `${connection.latency}ms` : ''
                ) : isLoading ? (
                  ''
                ) : (
                  `${row.total} total`
                )}
              </span>

              {/* Cost */}
              <span className="text-2xs text-muted-foreground w-20 shrink-0 font-mono-tight text-right hidden sm:block">
                {row.cost != null ? `$${row.cost.toFixed(2)}` : ''}
              </span>

              {/* Utilization bar (sessions with activity) */}
              {!isGateway && !isLoading && row.total > 0 && (
                <span className="hidden lg:inline-flex h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                  <span
                    className={`h-full rounded-full transition-all duration-500 ${
                      row.active / row.total > 0.8 ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, (row.active / row.total) * 100)}%` }}
                  />
                </span>
              )}
            </RowEl>
          )
        })}
      </div>
    </div>
  )
}
