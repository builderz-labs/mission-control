'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('AgentPerformance')

interface AgentPerformance {
  agent: string
  totalTasks: number
  completedTasks: number
  rejectedTasks: number
  successRate: number
  rejectionRate: number
  avgCompletionHours: number | null
  tasksByStatus: Record<string, number>
  recentCompletions: Array<{ title: string; completed_at: number; outcome: string }>
}

interface PerformanceResponse {
  performances: AgentPerformance[]
  totals: { totalTasks: number; completedTasks: number; rejectedTasks: number; agents: number }
  days: number
  generatedAt: string
}

const AGENT_COLORS: Record<string, string> = {
  ralph: 'border-blue-500/40 bg-blue-500/10',
  obsidian: 'border-purple-500/40 bg-purple-500/10',
  sentinel: 'border-cyan-500/40 bg-cyan-500/10',
}

const AGENT_BADGE: Record<string, string> = {
  ralph: 'bg-blue-500/20 text-blue-400',
  obsidian: 'bg-purple-500/20 text-purple-400',
  sentinel: 'bg-cyan-500/20 text-cyan-400',
}

export function AgentPerformancePanel() {
  const [data, setData] = useState<PerformanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent-performance?days=${days}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      log.error('Failed to fetch performance data:', err)
      setError('Failed to load performance data')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading && !data) {
    return <div className="p-6"><Loader variant="inline" /></div>
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-400">{error}</div>
        <Button variant="outline" size="sm" onClick={fetchData} className="mt-2">Retry</Button>
      </div>
    )
  }

  const totals = data?.totals || { totalTasks: 0, completedTasks: 0, rejectedTasks: 0, agents: 0 }
  const performances = data?.performances || []

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Agent Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Success rate, completion time, and rejection rate per agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 text-2xs rounded-md transition-colors ${
                days === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {d}d
            </button>
          ))}
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Agents" value={totals.agents} color="text-foreground" />
        <SummaryCard label="Tasks" value={totals.totalTasks} color="text-foreground" />
        <SummaryCard label="Completed" value={totals.completedTasks} color="text-emerald-400" />
        <SummaryCard label="Rejections" value={totals.rejectedTasks} color="text-amber-400" />
      </div>

      {/* Agent Cards */}
      {performances.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No agent performance data for the last {days} days
        </div>
      ) : (
        <div className="space-y-3">
          {performances.map(perf => (
            <AgentCard
              key={perf.agent}
              perf={perf}
              expanded={expandedAgent === perf.agent}
              onToggle={() => setExpandedAgent(expandedAgent === perf.agent ? null : perf.agent)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function AgentCard({ perf, expanded, onToggle }: { perf: AgentPerformance; expanded: boolean; onToggle: () => void }) {
  const colorClass = AGENT_COLORS[perf.agent] || 'border-zinc-500/40 bg-zinc-500/10'
  const badgeClass = AGENT_BADGE[perf.agent] || 'bg-zinc-500/20 text-zinc-400'

  return (
    <div className={`border rounded-lg overflow-hidden ${colorClass}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-secondary/30 transition-colors"
      >
        {/* Agent name */}
        <span className={`px-2.5 py-1 text-sm font-semibold rounded-full ${badgeClass}`}>
          {perf.agent}
        </span>

        {/* Stats row */}
        <div className="flex-1 grid grid-cols-4 gap-4">
          <StatCell label="Success" value={`${perf.successRate}%`} good={perf.successRate >= 70} />
          <StatCell label="Completed" value={String(perf.completedTasks)} />
          <StatCell label="Rejections" value={String(perf.rejectedTasks)} bad={perf.rejectionRate > 30} />
          <StatCell
            label="Avg Time"
            value={perf.avgCompletionHours != null ? `${perf.avgCompletionHours}h` : '-'}
          />
        </div>

        {/* Progress bar */}
        <div className="w-24 flex-shrink-0">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${perf.successRate}%` }}
            />
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-secondary/20">
          {/* Status breakdown */}
          <div>
            <div className="text-2xs text-muted-foreground mb-1">Tasks by Status</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(perf.tasksByStatus).map(([status, count]) => (
                <span key={status} className="px-2 py-0.5 text-2xs bg-secondary rounded text-foreground/80">
                  {status}: {count}
                </span>
              ))}
            </div>
          </div>

          {/* Recent completions */}
          {perf.recentCompletions.length > 0 && (
            <div>
              <div className="text-2xs text-muted-foreground mb-1">Recent Completions</div>
              <div className="space-y-1">
                {perf.recentCompletions.map((task, i) => (
                  <div key={i} className="flex items-center gap-2 text-2xs">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      task.outcome === 'success' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`} />
                    <span className="text-foreground/80 truncate">{task.title}</span>
                    <span className="text-muted-foreground flex-shrink-0">
                      {formatRelativeTime(task.completed_at * 1000)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCell({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div>
      <div className={`text-sm font-semibold ${good ? 'text-emerald-400' : bad ? 'text-amber-400' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="text-2xs text-muted-foreground">{label}</div>
    </div>
  )
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
