'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

interface AgentTokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

interface AgentCostEntry {
  agent: string
  stats: AgentTokenStats
  models: Record<string, AgentTokenStats>
  recentActivity: number | null
}

interface AgentCostData {
  agents: AgentCostEntry[]
  summary: AgentTokenStats
  timeframe: string
  agentCount: number
}

const COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#e11d48',
]

export function AgentCostPanel() {
  const [data, setData] = useState<AgentCostData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<string>('week')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tokens?action=by_agent&timeframe=${timeframe}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [timeframe])

  useEffect(() => { fetchData() }, [fetchData])

  function formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    if (cost < 1) return `$${cost.toFixed(3)}`
    return `$${cost.toFixed(2)}`
  }

  function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
    return tokens.toString()
  }

  function formatTime(ts: number | null) {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const barData = data?.agents.slice(0, 10).map((a) => ({
    name: a.agent.length > 12 ? a.agent.slice(0, 12) + '...' : a.agent,
    cost: parseFloat(a.stats.totalCost.toFixed(4)),
    tokens: a.stats.totalTokens,
  })) || []

  const pieData = data?.agents.slice(0, 8).map((a, i) => ({
    name: a.agent,
    value: parseFloat(a.stats.totalCost.toFixed(4)),
    fill: COLORS[i % COLORS.length],
  })) || []

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Agent Cost Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data ? `${data.agentCount} agent${data.agentCount !== 1 ? 's' : ''} · ${formatCost(data.summary.totalCost)} total` : 'Loading...'}
          </p>
        </div>
        <div className="flex gap-1">
          {['day', 'week', 'month', 'all'].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`h-7 px-2.5 rounded text-2xs font-medium transition-smooth ${
                timeframe === tf
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {tf === 'all' ? 'All' : tf.charAt(0).toUpperCase() + tf.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-lg shimmer" />)}
        </div>
      ) : !data || data.agents.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-xs text-muted-foreground">No token usage data found</p>
          <p className="text-2xs text-muted-foreground/60 mt-1">
            Token usage will appear here as agents interact with models
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            <SummaryCard label="Total Cost" value={formatCost(data.summary.totalCost)} />
            <SummaryCard label="Total Tokens" value={formatTokens(data.summary.totalTokens)} />
            <SummaryCard label="Requests" value={data.summary.requestCount.toString()} />
            <SummaryCard label="Avg Cost/Req" value={formatCost(data.summary.avgCostPerRequest)} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-3">
            {/* Bar chart - cost by agent */}
            {barData.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <h4 className="text-xs font-semibold text-foreground mb-2">Cost by Agent</h4>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                      formatter={(value: number | string | undefined) => [formatCost(Number(value ?? 0)), 'Cost']}
                    />
                    <Bar dataKey="cost" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Pie chart - cost distribution */}
            {pieData.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <h4 className="text-xs font-semibold text-foreground mb-2">Cost Distribution</h4>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                      formatter={(value: number | string | undefined) => [formatCost(Number(value ?? 0)), 'Cost']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {pieData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-1 text-2xs text-muted-foreground">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      {entry.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Agent list with expandable details */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-foreground">Per-Agent Details</h4>
            {data.agents.map((agent, idx) => {
              const isExpanded = expandedAgent === agent.agent
              const pct = data.summary.totalCost > 0
                ? ((agent.stats.totalCost / data.summary.totalCost) * 100).toFixed(1)
                : '0'

              return (
                <div key={agent.agent} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.agent)}
                    className="w-full text-left p-3 hover:bg-secondary/30 transition-smooth"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-sm font-medium text-foreground truncate">{agent.agent}</span>
                        <span className="text-2xs text-muted-foreground">{pct}%</span>
                      </div>
                      <div className="flex items-center gap-4 text-2xs text-muted-foreground shrink-0">
                        <span className="font-mono font-semibold text-foreground">{formatCost(agent.stats.totalCost)}</span>
                        <span>{formatTokens(agent.stats.totalTokens)} tokens</span>
                        <span>{agent.stats.requestCount} req</span>
                        <span className="text-muted-foreground/50">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {/* Cost proportion bar */}
                    <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(1, parseFloat(pct))}%`,
                          background: COLORS[idx % COLORS.length],
                        }}
                      />
                    </div>
                  </button>

                  {/* Expanded: per-model breakdown */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-border bg-secondary/20">
                      <div className="pt-2 space-y-1.5">
                        <div className="flex items-center justify-between text-2xs text-muted-foreground font-medium px-1">
                          <span>Model</span>
                          <div className="flex gap-6">
                            <span className="w-16 text-right">Cost</span>
                            <span className="w-16 text-right">Tokens</span>
                            <span className="w-10 text-right">Req</span>
                          </div>
                        </div>
                        {Object.entries(agent.models)
                          .sort(([, a], [, b]) => b.totalCost - a.totalCost)
                          .map(([model, stats]) => (
                            <div key={model} className="flex items-center justify-between text-2xs py-1 px-1 rounded hover:bg-secondary/50">
                              <span className="text-foreground font-mono truncate max-w-[200px]">
                                {model.split('/').pop() || model}
                              </span>
                              <div className="flex gap-6">
                                <span className="w-16 text-right font-mono text-foreground">{formatCost(stats.totalCost)}</span>
                                <span className="w-16 text-right font-mono text-muted-foreground">{formatTokens(stats.totalTokens)}</span>
                                <span className="w-10 text-right text-muted-foreground">{stats.requestCount}</span>
                              </div>
                            </div>
                          ))}
                        {agent.recentActivity && (
                          <p className="text-2xs text-muted-foreground/50 pt-1 px-1">
                            Last activity: {formatTime(agent.recentActivity)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5 font-mono">{value}</p>
    </div>
  )
}
