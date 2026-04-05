'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useNavigateToPanel } from '@/lib/navigation'
import type { AgentScore } from '@/lib/leaderboard-scoring'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'day' | 'week' | 'month'

interface LeaderboardResponse {
  agents: AgentScore[]
  period: Period
  generatedAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-400'
  if (score >= 70) return 'text-blue-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function trendIcon(trend: AgentScore['trend']): string {
  if (trend === 'up') return '↑'
  if (trend === 'down') return '↓'
  return '–'
}

function trendColor(trend: AgentScore['trend']): string {
  if (trend === 'up') return 'text-emerald-400'
  if (trend === 'down') return 'text-red-400'
  return 'text-muted-foreground'
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-block text-[10px] px-1.5 py-px rounded bg-primary/15 text-primary border border-primary/20 leading-none">
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function LeaderboardPanel() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('week')
  const navigateToPanel = useNavigateToPanel()

  const load = useCallback(async (p: Period) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/leaderboard?period=${p}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(period) }, [load, period])

  const handlePeriodChange = (p: Period) => {
    setPeriod(p)
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Agent Performance Leaderboard</h2>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {new Date(data.generatedAt).toLocaleTimeString()} · {data.agents.length} agents ranked
            </p>
          )}
        </div>

        {/* Period tabs */}
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handlePeriodChange(p)}
              className="capitalize"
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader variant="inline" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => load(period)}>Retry</Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data?.agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <svg className="w-10 h-10 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm text-muted-foreground">No agent activity in this period.</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && data && data.agents.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left px-4 py-3 font-medium w-10">#</th>
                <th className="text-left px-4 py-3 font-medium">Agent</th>
                <th className="text-left px-2 py-3 font-medium hidden md:table-cell">Role</th>
                <th className="text-right px-4 py-3 font-medium">Score</th>
                <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Completion</th>
                <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Tasks</th>
                <th className="text-center px-4 py-3 font-medium hidden lg:table-cell">Trend</th>
                <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Badges</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(agent => (
                <tr
                  key={agent.agentName}
                  onClick={() => navigateToPanel('agents')}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{agent.rank}</td>
                  <td className="px-4 py-3 font-medium text-foreground truncate max-w-[160px]">
                    {agent.agentName}
                  </td>
                  <td className="px-2 py-3 text-muted-foreground text-xs capitalize hidden md:table-cell">
                    {agent.role}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${scoreColor(agent.score)}`}>
                    {agent.score}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground hidden sm:table-cell">
                    {Math.round(agent.completionRate * 100)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                    {agent.tasksTotal}
                  </td>
                  <td className={`px-4 py-3 text-center font-bold hidden lg:table-cell ${trendColor(agent.trend)}`}>
                    {trendIcon(agent.trend)}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {agent.badges.map(b => <Badge key={b} label={b} />)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
