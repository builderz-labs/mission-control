'use client'

import { useState, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type {
  WarRoomSnapshot,
  CriticalAgent,
  ActiveAlert,
  RecentError,
  ServiceStatus,
  WarRoomStats,
} from '@/app/api/war-room/route'

// ── Relative time helper ──────────────────────────────────────────────────────

function timeAgo(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  variant: 'critical' | 'warning' | 'neutral'
}

function WarRoomStatCard({ label, value, variant }: StatCardProps): React.JSX.Element {
  const styles: Record<StatCardProps['variant'], string> = {
    critical: 'bg-red-950/50 border border-red-800 text-red-400',
    warning:  'bg-amber-950/50 border border-amber-800 text-amber-400',
    neutral:  'bg-secondary/40 border border-border text-muted-foreground',
  }

  return (
    <div className={`rounded-lg p-3 flex flex-col items-center gap-1 ${styles[variant]}`}>
      <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-[10px] uppercase tracking-widest font-medium opacity-80 text-center">
        {label}
      </span>
    </div>
  )
}

interface AgentCrisisRowProps {
  agent: CriticalAgent
}

function AgentCrisisRow({ agent }: AgentCrisisRowProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: agent.color }}
      />
      <span className="text-xs text-foreground/90 truncate flex-1 min-w-0">{agent.name}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Score bar */}
        <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              agent.level === 'critical' ? 'bg-red-500' : 'bg-amber-500'
            }`}
            style={{ width: `${agent.score}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">
          {agent.score}
        </span>
      </div>
    </div>
  )
}

interface HealthServiceRowProps {
  serviceName: string
  status: string
}

function HealthServiceRow({ serviceName, status }: HealthServiceRowProps): React.JSX.Element {
  const isHealthy = status === 'healthy'
  const dotColor = isHealthy ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
  const labelColor = isHealthy ? 'text-emerald-400' : status === 'degraded' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className="text-xs text-foreground/80 flex-1 truncate capitalize">{serviceName}</span>
      <span className={`text-[10px] uppercase tracking-wide font-medium ${labelColor}`}>
        {status}
      </span>
    </div>
  )
}

// ── Type badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-red-950/60 text-red-400 border border-red-800/50 flex-shrink-0">
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function WarRoomSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      {/* Stat cards row */}
      <div className="grid grid-cols-4 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-secondary/40" />
        ))}
      </div>
      {/* Two-column section */}
      <div className="grid grid-cols-2 gap-3">
        <div className="h-40 rounded-lg bg-secondary/40" />
        <div className="h-40 rounded-lg bg-secondary/40" />
      </div>
      {/* Events feed */}
      <div className="h-48 rounded-lg bg-secondary/40" />
    </div>
  )
}

// ── Status badge for overall system health ────────────────────────────────────

function SystemHealthBadge({ status }: { status: WarRoomSnapshot['systemHealth'] }): React.JSX.Element {
  const config: Record<WarRoomSnapshot['systemHealth'], { label: string; classes: string; pulse: boolean }> = {
    healthy:  { label: 'HEALTHY',  classes: 'bg-emerald-950/60 text-emerald-400 border-emerald-700', pulse: false },
    degraded: { label: 'DEGRADED', classes: 'bg-amber-950/60 text-amber-400 border-amber-700', pulse: false },
    critical: { label: 'CRITICAL', classes: 'bg-red-950/60 text-red-400 border-red-700', pulse: true },
  }
  const { label, classes, pulse } = config[status]

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-bold tracking-widest ${classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'healthy' ? 'bg-emerald-400' : status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'} ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatsRow({ stats }: { stats: WarRoomStats }): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2">
      <WarRoomStatCard label="Critical" value={stats.criticalCount} variant="critical" />
      <WarRoomStatCard label="Warning"  value={stats.warningCount}  variant="warning"  />
      <WarRoomStatCard label="Alerts"   value={stats.activeAlertCount} variant="neutral" />
      <WarRoomStatCard label="Errors 24h" value={stats.errorCount24h} variant="neutral" />
    </div>
  )
}

// ── Agents column ─────────────────────────────────────────────────────────────

interface AgentsColumnProps {
  criticalAgents: CriticalAgent[]
  warningAgents: CriticalAgent[]
}

function AgentsColumn({ criticalAgents, warningAgents }: AgentsColumnProps): React.JSX.Element {
  const combined = [...criticalAgents, ...warningAgents].slice(0, 8)

  return (
    <div className="bg-card/50 border border-border rounded-lg p-3 flex flex-col gap-1">
      <h3 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
        Critical Agents
      </h3>
      {combined.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-2 text-center">All agents nominal</p>
      ) : (
        combined.map(agent => (
          <AgentCrisisRow key={agent.id} agent={agent} />
        ))
      )}
    </div>
  )
}

// ── Health column ─────────────────────────────────────────────────────────────

interface HealthColumnProps {
  services: ReadonlyArray<ServiceStatus>
  healthScore: number
}

function HealthColumn({ services, healthScore }: HealthColumnProps): React.JSX.Element {
  return (
    <div className="bg-card/50 border border-border rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
          System Health
        </h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">{healthScore}%</span>
      </div>
      {services.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-2 text-center">No services tracked</p>
      ) : (
        services.slice(0, 8).map(svc => (
          <HealthServiceRow key={svc.serviceName} serviceName={svc.serviceName} status={svc.status} />
        ))
      )}
    </div>
  )
}

// ── Recent errors feed ────────────────────────────────────────────────────────

function ErrorsFeed({ errors }: { errors: RecentError[] }): React.JSX.Element {
  return (
    <div className="bg-card/50 border border-border rounded-lg p-3">
      <h3 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
        Recent Critical Events
      </h3>
      {errors.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-2 text-center">No recent critical events</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
          {errors.map(err => (
            <div key={err.id} className="flex items-start gap-2 py-1 border-b border-border/40 last:border-0">
              <span className="text-[10px] text-muted-foreground/60 w-14 flex-shrink-0 pt-0.5 tabular-nums">
                {timeAgo(err.created_at)}
              </span>
              <TypeBadge type={err.type} />
              <span className="text-xs text-foreground/80 flex-1 min-w-0 truncate">{err.title}</span>
              {err.agent_name && (
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 truncate max-w-[80px]">
                  {err.agent_name}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WarRoomPanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WarRoomSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/war-room')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as WarRoomSnapshot
      setSnapshot(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load war room data')
    } finally {
      setLoading(false)
    }
  }, [])

  const retry = useSmartPoll(fetchSnapshot, 10_000)

  // Loading state
  if (loading && !snapshot) return <WarRoomSkeleton />

  // Error state
  if (error && !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-sm text-red-400">{error}</span>
        <button
          onClick={retry}
          className="px-3 py-1.5 rounded text-xs bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!snapshot) return <WarRoomSkeleton />

  return (
    <div className="flex flex-col gap-3 p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          War Room
        </h2>
        <SystemHealthBadge status={snapshot.systemHealth} />
      </div>

      {/* Top stat cards */}
      <StatsRow stats={snapshot.stats} />

      {/* Two-column: agents + health */}
      <div className="grid grid-cols-2 gap-3">
        <AgentsColumn
          criticalAgents={snapshot.criticalAgents}
          warningAgents={snapshot.warningAgents}
        />
        <HealthColumn
          services={snapshot.services}
          healthScore={snapshot.healthScore}
        />
      </div>

      {/* Recent errors feed */}
      <ErrorsFeed errors={snapshot.recentErrors} />

      {/* Last updated */}
      <p className="text-[10px] text-muted-foreground/40 text-right">
        Updated {timeAgo(Math.floor(snapshot.timestamp / 1000))}
      </p>

      {/* Soft error banner when polling fails but stale data is shown */}
      {error && (
        <p className="text-[10px] text-amber-400/70 text-center">
          Live refresh failed — showing cached data
        </p>
      )}
    </div>
  )
}
