'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface AgentCostData {
  stats: { totalTokens: number; totalCost: number; requestCount: number; avgTokensPerRequest: number; avgCostPerRequest: number }
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: string[]
  timeline: Array<{ date: string; cost: number; tokens: number }>
}

interface AgentCostsResponse {
  agents: Record<string, AgentCostData>
  timeframe: string
  recordCount: number
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

export function AgentCostPanel() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [data, setData] = useState<AgentCostsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tokens?action=agent-costs&timeframe=${selectedTimeframe}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      console.error('Failed to load agent costs:', err)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  useEffect(() => { loadData() }, [loadData])

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
    return num.toString()
  }

  const formatCost = (cost: number) => '$' + cost.toFixed(4)

  const agents = data?.agents ? Object.entries(data.agents) : []
  const sortedAgents = agents.sort(([, a], [, b]) => b.stats.totalCost - a.stats.totalCost)

  const totalCost = agents.reduce((sum, [, a]) => sum + a.stats.totalCost, 0)
  const totalAgents = agents.length

  const mostExpensive = sortedAgents[0]
  const mostEfficient = agents.length > 0
    ? agents.reduce((best, curr) => {
        const currCostPer1k = curr[1].stats.totalCost / Math.max(1, curr[1].stats.totalTokens) * 1000
        const bestCostPer1k = best[1].stats.totalCost / Math.max(1, best[1].stats.totalTokens) * 1000
        return currCostPer1k < bestCostPer1k ? curr : best
      })
    : null

  // Pie chart data
  const pieData = sortedAgents.slice(0, 8).map(([name, a]) => ({
    name,
    value: a.stats.totalCost,
  }))

  // Line chart: top 5 agents over time
  const top5 = sortedAgents.slice(0, 5).map(([name]) => name)
  const allDates = new Set<string>()
  for (const [name, a] of agents) {
    if (top5.includes(name)) {
      for (const t of a.timeline) allDates.add(t.date)
    }
  }
  const trendData = [...allDates].sort().map(date => {
    const point: Record<string, string | number> = { date: date.slice(5) } // MM-DD
    for (const name of top5) {
      const entry = data?.agents[name]?.timeline.find(t => t.date === date)
      point[name] = entry?.cost ?? 0
    }
    return point
  })

  // Efficiency bars
  const efficiencyData = sortedAgents.map(([name, a]) => ({
    name,
    costPer1k: a.stats.totalCost / Math.max(1, a.stats.totalTokens) * 1000,
  }))
  const maxCostPer1k = Math.max(...efficiencyData.map(d => d.costPer1k), 0.0001)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Agent Cost Breakdown</h1>
            <p className="text-muted-foreground mt-2">Per-agent token usage and spend analysis</p>
          </div>
          <div className="flex space-x-2">
            {(['hour', 'day', 'week', 'month'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                  selectedTimeframe === tf
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                }`}
              >
                {tf.charAt(0).toUpperCase() + tf.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <span className="ml-3 text-muted-foreground">Loading agent costs...</span>
        </div>
      ) : !data || agents.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">No agent cost data available</div>
          <div className="text-sm">Cost data will appear once agents start using tokens</div>
          <button onClick={loadData} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            Refresh
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">{totalAgents}</div>
              <div className="text-sm text-muted-foreground">Total Agents</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">{formatCost(totalCost)}</div>
              <div className="text-sm text-muted-foreground">Total Cost ({selectedTimeframe})</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-orange-500">{mostExpensive?.[0] || '-'}</div>
              <div className="text-sm text-muted-foreground">Most Expensive Agent</div>
              {mostExpensive && <div className="text-xs text-muted-foreground mt-1">{formatCost(mostExpensive[1].stats.totalCost)}</div>}
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-green-500">{mostEfficient?.[0] || '-'}</div>
              <div className="text-sm text-muted-foreground">Most Efficient Agent</div>
              {mostEfficient && (
                <div className="text-xs text-muted-foreground mt-1">
                  ${(mostEfficient[1].stats.totalCost / Math.max(1, mostEfficient[1].stats.totalTokens) * 1000).toFixed(4)}/1K tokens
                </div>
              )}
            </div>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Cost Distribution Pie */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Cost Distribution by Agent</h2>
              <div className="h-64">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No cost data</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={5} dataKey="value">
                        {pieData.map((_, i) => (
                          <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCost(Number(value))} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Cost Trend Lines */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Cost Trends (Top 5 Agents)</h2>
              <div className="h-64">
                {trendData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No trend data</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCost(Number(value))} />
                      <Legend />
                      {top5.map((name, i) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Cost Efficiency Comparison */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Cost Efficiency ($/1K Tokens per Agent)</h2>
            <div className="space-y-2">
              {efficiencyData.map(({ name, costPer1k }) => (
                <div key={name} className="flex items-center text-sm">
                  <div className="w-32 truncate text-muted-foreground font-medium">{name}</div>
                  <div className="flex-1 mx-3">
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${(costPer1k / maxCostPer1k) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 text-right text-xs text-muted-foreground">${costPer1k.toFixed(4)}/1K</div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent Cost Ranking Table */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Agent Cost Ranking</h2>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {sortedAgents.map(([name, a], index) => (
                <div key={name} className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedAgent(expandedAgent === name ? null : name)}
                    className="w-full p-4 flex items-center justify-between hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-6">#{index + 1}</span>
                      <span className="font-medium text-foreground">{name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                        {a.sessions.length} session{a.sessions.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <div className="font-medium text-foreground">{formatCost(a.stats.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(a.stats.totalTokens)} tokens</div>
                      </div>
                      <div className="text-right">
                        <div className="text-muted-foreground">{a.stats.requestCount} reqs</div>
                        <div className="text-xs text-muted-foreground">{formatCost(a.stats.avgCostPerRequest)} avg</div>
                      </div>
                      <svg
                        className={`w-4 h-4 text-muted-foreground transition-transform ${expandedAgent === name ? 'rotate-180' : ''}`}
                        viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                      >
                        <polyline points="4,6 8,10 12,6" />
                      </svg>
                    </div>
                  </button>

                  {expandedAgent === name && (
                    <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                      <div className="pt-3 text-sm">
                        <h4 className="font-medium text-muted-foreground mb-2">Model Breakdown</h4>
                        <div className="space-y-1.5">
                          {Object.entries(a.models)
                            .sort(([, x], [, y]) => y.totalCost - x.totalCost)
                            .map(([model, stats]) => {
                              const displayName = model.split('/').pop() || model
                              return (
                                <div key={model} className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{displayName}</span>
                                  <div className="flex gap-4">
                                    <span>{formatNumber(stats.totalTokens)} tokens</span>
                                    <span>{stats.requestCount} reqs</span>
                                    <span className="font-medium text-foreground">{formatCost(stats.totalCost)}</span>
                                  </div>
                                </div>
                              )
                            })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
