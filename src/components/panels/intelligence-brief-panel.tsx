'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import type { IntelligenceBrief } from '@/lib/intelligence-brief'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BriefResponse {
  brief: IntelligenceBrief
  fromCache: boolean
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold text-foreground">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

function TopAgentsList({ agents }: { agents: IntelligenceBrief['topAgents'] }) {
  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No agent activity this week.</p>
  }
  return (
    <ol className="space-y-2">
      {agents.map((a, i) => (
        <li key={a.name} className="flex items-center gap-3 text-sm">
          <span className="w-5 text-muted-foreground font-mono text-xs">{i + 1}.</span>
          <span className="flex-1 font-medium text-foreground truncate">{a.name}</span>
          <span className="text-xs text-muted-foreground capitalize">{a.role}</span>
          <span className="text-xs tabular-nums text-primary">{a.tasksCompleted} tasks</span>
        </li>
      ))}
    </ol>
  )
}

function CostMoversTable({ movers }: { movers: IntelligenceBrief['costMovers'] }) {
  if (movers.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No cost data available.</p>
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground border-b border-border">
          <th className="text-left pb-2 font-medium">Model</th>
          <th className="text-right pb-2 font-medium">Cost</th>
          <th className="text-right pb-2 font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {movers.map(m => (
          <tr key={m.model} className="border-b border-border/50 last:border-0">
            <td className="py-2 font-mono text-xs text-foreground truncate max-w-[140px]">{m.model}</td>
            <td className="py-2 text-right tabular-nums">${m.cost.toFixed(4)}</td>
            <td className={`py-2 text-right tabular-nums text-xs font-medium ${
              m.changePercent > 0 ? 'text-red-400' : 'text-green-400'
            }`}>
              {m.changePercent > 0 ? '+' : ''}{m.changePercent}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StringList({ items, emptyText, colorClass }: {
  items: string[]
  emptyText: string
  colorClass?: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{emptyText}</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className={`text-sm flex gap-2 ${colorClass ?? 'text-foreground'}`}>
          <span className="mt-0.5 shrink-0 text-xs">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function IntelligenceBriefPanel() {
  const [data, setData] = useState<BriefResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const load = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    if (method === 'POST') setRegenerating(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/intelligence-brief', {
        method,
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brief')
    } finally {
      setLoading(false)
      setRegenerating(false)
    }
  }, [])

  useEffect(() => { load('GET') }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader variant="inline" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between">
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={() => load('GET')}>Retry</Button>
      </div>
    )
  }

  if (!data) return null

  const { brief } = data
  const { summary, topAgents, costMovers, anomalies, recommendations } = brief
  const completionPct = Math.round(summary.completionRate * 100)

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Weekly Intelligence Brief</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {brief.weekOf} · Generated {new Date(brief.generatedAt).toLocaleTimeString()}
            {data.fromCache && <span className="ml-1 text-primary">(cached)</span>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load('POST')}
          disabled={regenerating}
        >
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Tasks Completed" value={summary.totalTasksCompleted} />
        <SummaryCard label="Completion Rate" value={`${completionPct}%`} sub={`${summary.totalTasksFailed} failed`} />
        <SummaryCard
          label="Total Cost"
          value={`$${summary.totalCostUsd.toFixed(4)}`}
          sub={summary.costChangePercent !== 0
            ? `${summary.costChangePercent > 0 ? '+' : ''}${summary.costChangePercent}% vs last week`
            : 'No change'}
        />
        <SummaryCard label="Active Agents" value={summary.activeAgents} sub={`${summary.newPatternsLearned} patterns learned`} />
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <h3 className="text-sm font-semibold text-yellow-400 mb-2">Anomalies</h3>
          <StringList items={anomalies} emptyText="" colorClass="text-yellow-300" />
        </div>
      )}

      {/* Two-column: top agents + cost movers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Top Agents</h3>
          <TopAgentsList agents={topAgents} />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Cost Movers</h3>
          <CostMoversTable movers={costMovers} />
        </div>
      </div>

      {/* Recommendations */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Recommendations</h3>
        <StringList
          items={recommendations}
          emptyText="No recommendations at this time."
          colorClass="text-muted-foreground"
        />
      </div>
    </div>
  )
}
