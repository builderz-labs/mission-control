'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Button } from '@/components/ui/button'

type Check = {
  name: string
  status: string
  points: number
  max_points: number
  detail: string
}

type Dimension = {
  name: string
  weight: number
  points: number
  status: string
  signals: string[]
  gaps: string[]
}

type AiTeamOsPayload = {
  generatedAt: string
  missing: string[]
  health: {
    generated_at: string
    score: number
    status: string
    checks: Check[]
  } | null
  excellence: {
    generated_at: string
    score: number
    status: string
    north_star: string
    dimensions: Dimension[]
    red_flags: string[]
    next_actions: string[]
  } | null
  budgetControl: {
    generated_at: string
    status: string
    controls_passed: number
    controls_total: number
    controls: Record<string, boolean>
    next_actions: string[]
  } | null
  ciBacklog: {
    generated_at: string
    summary: {
      total: number
      delivery_control_blockers: number
      by_classification: Record<string, number>
    }
    prs: Array<{
      number: number
      title: string
      url: string
      classification: string
      ci_state: string
      next_action: string
    }>
  } | null
  evalCoverage: {
    generated_at: string
    score: number
    status: string
    weak_areas: string[]
    areas: Array<{
      name: string
      status: string
      points: number
      max_points: number
      signals: string[]
      gaps: string[]
    }>
  } | null
}

function statusClass(status: string) {
  const value = status.toLowerCase()
  if (value.includes('excellent') || value.includes('healthy') || value === 'pass' || value === 'controlled') {
    return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
  }
  if (value.includes('competitive') || value.includes('managed') || value.includes('warn') || value.includes('degraded')) {
    return 'bg-amber-500/10 text-amber-600 border-amber-500/30'
  }
  return 'bg-red-500/10 text-red-600 border-red-500/30'
}

function formatTime(value?: string) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function Pill({ children, status }: { children: React.ReactNode; status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
      {children}
    </span>
  )
}

function MetricCard({ label, value, status, detail }: { label: string; value: string; status: string; detail?: string }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 min-h-[112px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums tracking-normal">{value}</div>
        </div>
        <Pill status={status}>{status}</Pill>
      </div>
      {detail && <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{detail}</p>}
    </section>
  )
}

export function AiTeamOsPanel() {
  const [data, setData] = useState<AiTeamOsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-team-os')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = await res.json()
      setData(payload)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load AI Team OS')
    }
  }, [])

  useSmartPoll(fetchData, 15000)

  const checks = useMemo(() => {
    return data?.health?.checks || []
  }, [data])

  const failedOrWarnChecks = checks.filter(check => check.status !== 'PASS')
  const dimensions = data?.excellence?.dimensions || []
  const ciClasses = data?.ciBacklog?.summary?.by_classification || {}
  const controls = data?.budgetControl?.controls || {}
  const evalAreas = data?.evalCoverage?.areas || []

  if (!data) {
    return (
      <div className="p-5 flex items-center justify-center h-64 text-muted-foreground">
        {error ? `Error: ${error}` : 'Loading AI Team OS...'}
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Team OS</h2>
          <p className="text-sm text-muted-foreground">
            Customer-oriented operating scorecard for the VoxSign AI team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Updated {formatTime(data.excellence?.generated_at || data.health?.generated_at)}</span>
          <Button variant="outline" size="sm" onClick={fetchData}>Refresh</Button>
        </div>
      </div>

      {data.missing.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
          Missing AI Team OS inputs: {data.missing.join(', ')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <MetricCard
          label="Excellence"
          value={`${data.excellence?.score ?? 0}/100`}
          status={data.excellence?.status || 'unknown'}
          detail={data.excellence?.north_star || 'Customer-Visible Value Velocity'}
        />
        <MetricCard
          label="Health"
          value={`${data.health?.score ?? 0}/100`}
          status={data.health?.status || 'unknown'}
          detail={failedOrWarnChecks[0]?.detail || 'No blocking health finding'}
        />
        <MetricCard
          label="Budget Control"
          value={`${data.budgetControl?.controls_passed ?? 0}/${data.budgetControl?.controls_total ?? 0}`}
          status={data.budgetControl?.status || 'unknown'}
          detail={data.budgetControl?.next_actions?.[0]}
        />
        <MetricCard
          label="CI/PR Backlog"
          value={`${data.ciBacklog?.summary?.delivery_control_blockers ?? 0} blockers`}
          status={(data.ciBacklog?.summary?.delivery_control_blockers ?? 0) > 0 ? 'WARN' : 'PASS'}
          detail={`${data.ciBacklog?.summary?.total ?? 0} open PRs`}
        />
        <MetricCard
          label="Eval Coverage"
          value={`${data.evalCoverage?.score ?? 0}/100`}
          status={data.evalCoverage?.status || 'unknown'}
          detail={data.evalCoverage?.weak_areas?.[0] || 'Critical AI behaviors covered'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="rounded-lg border border-border bg-card p-4 xl:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold">Excellence Dimensions</h3>
            <Pill status={data.excellence?.status || 'unknown'}>{data.excellence?.status || 'unknown'}</Pill>
          </div>
          <div className="space-y-3">
            {dimensions.map(dimension => (
              <div key={dimension.name}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium truncate">{dimension.name}</span>
                  <span className="font-mono text-xs tabular-nums">{dimension.points}/{dimension.weight}</span>
                </div>
                <div className="mt-1 h-2 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round((dimension.points / dimension.weight) * 100))}%` }}
                  />
                </div>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <Pill status={dimension.status}>{dimension.status}</Pill>
                  <p className="text-xs text-muted-foreground text-right line-clamp-1">
                    {dimension.gaps?.[0] || dimension.signals?.[0] || 'No gap recorded'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Red Flags</h3>
          {data.excellence?.red_flags?.length ? (
            <div className="space-y-2">
              {data.excellence.red_flags.map(flag => (
                <div key={flag} className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                  {flag}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No red flags.</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">CI/PR Delivery Control</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {Object.entries(ciClasses).map(([name, count]) => (
              <div key={name} className="rounded-md border border-border bg-background p-3">
                <div className="text-xs text-muted-foreground">{name}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{count}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {(data.ciBacklog?.prs || []).slice(0, 8).map(pr => (
              <a
                key={pr.number}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-border px-3 py-2 hover:bg-secondary transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate">#{pr.number} {pr.title}</span>
                  <Pill status={pr.classification}>{pr.classification}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{pr.next_action}</p>
              </a>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Budget Controls</h3>
          <div className="space-y-2">
            {Object.entries(controls).map(([name, passed]) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <span className="text-sm truncate">{name.replace(/_/g, ' ')}</span>
                <Pill status={passed ? 'PASS' : 'FAIL'}>{passed ? 'PASS' : 'FAIL'}</Pill>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold">AI Behavior Eval Coverage</h3>
          <Pill status={data.evalCoverage?.status || 'unknown'}>{data.evalCoverage?.status || 'unknown'}</Pill>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {evalAreas.map(area => (
            <div key={area.name} className="rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{area.name}</span>
                <span className="font-mono text-xs tabular-nums">{area.points}/{area.max_points}</span>
              </div>
              <div className="mt-2 h-2 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.min(100, Math.round((area.points / area.max_points) * 100))}%` }}
                />
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <Pill status={area.status}>{area.status}</Pill>
                <p className="text-xs text-muted-foreground text-right line-clamp-1">
                  {area.gaps?.[0] || area.signals?.[0] || 'No gap recorded'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Next Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(data.excellence?.next_actions || []).map(action => (
            <div key={action} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
              {action}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
