'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'

const log = createClientLogger('AgentCostPanel')

interface TokenStats {
  totalTokens: number; totalCost: number; requestCount: number
  avgTokensPerRequest: number; avgCostPerRequest: number
}

interface AgentCostData {
  stats: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: string[]
  timeline: Array<{ date: string; cost: number; tokens: number }>
}

interface AgentCostsResponse {
  agents: Record<string, AgentCostData>
  timeframe: string
  recordCount: number
}

interface ByAgentModelBreakdown {
  model: string
  input_tokens: number
  output_tokens: number
  request_count: number
  cost: number
}

interface ByAgentEntry {
  agent: string
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost: number
  session_count: number
  request_count: number
  last_active: string
  models: ByAgentModelBreakdown[]
}

interface ByAgentResponse {
  agents: ByAgentEntry[]
  summary: {
    total_cost: number
    total_tokens: number
    agent_count: number
    days: number
  }
}

interface TaskCostEntry {
  taskId: number
  title: string
  status: string
  priority: string
  assignedTo?: string | null
  project: { id?: number | null; name?: string | null; slug?: string | null; ticketRef?: string | null }
  stats: TokenStats
  models: Record<string, TokenStats>
}

interface TaskCostsResponse {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, { stats: TokenStats; taskCount: number; taskIds: number[] }>
  unattributed: TokenStats
  timeframe: string
}

const REFRESH_INTERVAL = 30_000 // 30s auto-refresh

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

function PerAgentBreakdown({
  data,
  formatCost,
  formatNumber,
  onRefresh,
}: {
  data: ByAgentResponse | null
  formatCost: (cost: number) => string
  formatNumber: (num: number) => string
  onRefresh: () => void
}) {
  const t = useTranslations('agentCost')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  if (!data || data.agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noPerAgentData')}</div>
        <div className="text-sm">{t('noPerAgentDataSubtitle')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  const { agents, summary } = data
  const maxCost = Math.max(...agents.map((a) => a.total_cost), 0.0001)

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">{t('agentCountDB')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCostDays', { days: summary.days })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0
              ? `$${(summary.total_cost / summary.total_tokens * 1000).toFixed(4)}`
              : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('avgPer1kTokens')}</div>
        </div>
      </div>

      {/* Cost bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('perAgentCostDB')}</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agents.slice(0, 12).map((a) => ({
              name: a.agent.length > 12 ? a.agent.slice(0, 11) + '\u2026' : a.agent,
              cost: Number(a.total_cost.toFixed(4)),
              input: a.total_input_tokens,
              output: a.total_output_tokens,
            }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, dataKey) =>
                dataKey === 'cost' ? formatCost(Number(value)) : formatNumber(Number(value))
              } />
              <Legend />
              <Bar dataKey="cost" fill="#0088FE" name={t('chartCost')} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent detail table */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('agentTokenBreakdown')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map((agent) => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedRow === agent.agent
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button
                  onClick={() => setExpandedRow(isExpanded ? null : agent.agent)}
                  variant="ghost"
                  className="w-full p-4 h-auto flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-foreground truncate">{agent.agent}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {t('sessionCount', { count: agent.session_count })}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      {t('requestCount', { count: agent.request_count })}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    {/* Cost bar indicator */}
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${(agent.total_cost / maxCost) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">{t('tokens')}</div>
                    </div>
                    <svg
                      className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    >
                      <polyline points="4,6 8,10 12,6" />
                    </svg>
                  </div>
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 mb-3">
                      <div>
                        <div className="text-xs text-muted-foreground">{t('inputTokens')}</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('outputTokens')}</div>
                        <div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('ioRatio')}</div>
                        <div className="text-sm font-medium">
                          {agent.total_output_tokens > 0
                            ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2)
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t('lastActive')}</div>
                        <div className="text-sm font-medium">
                          {new Date(agent.last_active).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    {agent.models.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground font-medium mb-2">{t('modelBreakdown')}</div>
                        <div className="space-y-1.5">
                          {agent.models.map((m) => {
                            const displayName = m.model.split('/').pop() || m.model
                            return (
                              <div key={m.model} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground truncate">{displayName}</span>
                                <div className="flex gap-4 shrink-0">
                                  <span>{formatNumber(m.input_tokens)} {t('inSuffix')}</span>
                                  <span>{formatNumber(m.output_tokens)} {t('outSuffix')}</span>
                                  <span>{t('reqs', { count: m.request_count })}</span>
                                  <span className="font-medium text-foreground w-16 text-right">{formatCost(m.cost)}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function AgentCostPanel() {
  const t = useTranslations('agentCost')
  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [data, setData] = useState<AgentCostsResponse | null>(null)
  const [taskData, setTaskData] = useState<TaskCostsResponse | null>(null)
  const [byAgentData, setByAgentData] = useState<ByAgentResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<'models' | 'tasks'>('tasks')
  const [activeView, setActiveView] = useState<'overview' | 'per-agent'>('overview')
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Map timeframe to days param for the by-agent endpoint
  const timeframeToDays = (tf: string): number => {
    switch (tf) {
      case 'hour': return 1
      case 'day': return 1
      case 'week': return 7
      case 'month': return 30
      default: return 30
    }
  }

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [agentRes, taskRes, byAgentRes] = await Promise.all([
        fetch(`/api/tokens?action=agent-costs&timeframe=${selectedTimeframe}`),
        fetch(`/api/tokens?action=task-costs&timeframe=${selectedTimeframe}`),
        fetch(`/api/tokens/by-agent?days=${timeframeToDays(selectedTimeframe)}`),
      ])
      const [agentJson, taskJson, byAgentJson] = await Promise.all([
        agentRes.json(), taskRes.json(), byAgentRes.json(),
      ])
      setData(agentJson)
      setTaskData(taskJson)
      setByAgentData(byAgentJson)
    } catch (err) {
      log.error('Failed to load agent costs:', err)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  useEffect(() => { loadData() }, [loadData])

  // Auto-refresh every 30s
  useEffect(() => {
    refreshTimer.current = setInterval(loadData, REFRESH_INTERVAL)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadData])

  // Helper: get tasks for a specific agent from task-costs data
  const getAgentTasks = useCallback((agentName: string): TaskCostEntry[] => {
    if (!taskData) return []
    const agentEntry = taskData.agents[agentName]
    if (!agentEntry) return []
    return taskData.tasks.filter(t => agentEntry.taskIds.includes(t.taskId))
  }, [taskData])

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
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex space-x-1 bg-secondary rounded-lg p-1">
              <Button
                onClick={() => setActiveView('overview')}
                variant={activeView === 'overview' ? 'default' : 'ghost'}
                size="sm"
              >
                {t('viewOverview')}
              </Button>
              <Button
                onClick={() => setActiveView('per-agent')}
                variant={activeView === 'per-agent' ? 'default' : 'ghost'}
                size="sm"
              >
                {t('viewPerAgentDB')}
              </Button>
            </div>
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map((tf) => (
                <Button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  variant={selectedTimeframe === tf ? 'default' : 'secondary'}
                >
                  {t(`timeframe${tf.charAt(0).toUpperCase() + tf.slice(1)}` as 'timeframeHour' | 'timeframeDay' | 'timeframeWeek' | 'timeframeMonth')}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Loader variant="panel" label={t('loadingAgentCosts')} />
      ) : activeView === 'per-agent' ? (
        <PerAgentBreakdown data={byAgentData} formatCost={formatCost} formatNumber={formatNumber} onRefresh={loadData} />
      ) : !data || agents.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">{t('noAgentCostData')}</div>
          <div className="text-sm">{t('noAgentCostSubtitle')}</div>
          <Button onClick={loadData} className="mt-4">
            {t('refresh')}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="text-3xl font-bold text-foreground">{totalAgents}</div>
              <div className="text-sm text-muted-foreground">{t('activeAgents')}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="text-3xl font-bold text-foreground">{formatCost(totalCost)}</div>
              <div className="text-sm text-muted-foreground">{t('totalCost', { timeframe: selectedTimeframe })}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="text-3xl font-bold text-orange-500 truncate">{mostExpensive?.[0] || '-'}</div>
              <div className="text-sm text-muted-foreground">{t('mostExpensive')}</div>
              {mostExpensive && <div className="text-xs text-muted-foreground mt-1">{formatCost(mostExpensive[1].stats.totalCost)} ({((mostExpensive[1].stats.totalCost / Math.max(totalCost, 0.0001)) * 100).toFixed(0)}%)</div>}
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="text-3xl font-bold text-green-500 truncate">{mostEfficient?.[0] || '-'}</div>
              <div className="text-sm text-muted-foreground">{t('mostEfficient')}</div>
              {mostEfficient && (
                <div className="text-xs text-muted-foreground mt-1">
                  ${(mostEfficient[1].stats.totalCost / Math.max(1, mostEfficient[1].stats.totalTokens) * 1000).toFixed(4)}/1K tokens
                </div>
              )}
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="text-3xl font-bold text-foreground">
                {taskData ? `${((1 - taskData.unattributed.totalCost / Math.max(totalCost, 0.0001)) * 100).toFixed(0)}%` : '-'}
              </div>
              <div className="text-sm text-muted-foreground">{t('taskAttributed')}</div>
              {taskData && taskData.unattributed.totalCost > 0 && (
                <div className="text-xs text-muted-foreground mt-1">{t('unattributed', { cost: formatCost(taskData.unattributed.totalCost) })}</div>
              )}
            </div>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Cost Distribution Pie */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('costDistributionByAgent')}</h2>
              <div className="h-64">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
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
              <h2 className="text-xl font-semibold mb-4">{t('costTrends')}</h2>
              <div className="h-64">
                {trendData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
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

          {/* Agent Cost Comparison Bar Chart */}
          {sortedAgents.length > 1 && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('costComparison')}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sortedAgents.slice(0, 10).map(([name, a]) => ({
                    name: name.length > 12 ? name.slice(0, 11) + '…' : name,
                    cost: Number(a.stats.totalCost.toFixed(4)),
                    tokens: a.stats.totalTokens,
                    requests: a.stats.requestCount,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value, dataKey) =>
                      dataKey === 'cost' ? formatCost(Number(value)) : formatNumber(Number(value))
                    } />
                    <Legend />
                    <Bar dataKey="cost" fill="#0088FE" name={t('chartCost')} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Cost Efficiency Comparison */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">{t('costEfficiency')}</h2>
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
            <h2 className="text-xl font-semibold mb-4">{t('agentCostRanking')}</h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {sortedAgents.map(([name, a], index) => {
                const costShare = ((a.stats.totalCost / Math.max(totalCost, 0.0001)) * 100)
                const agentTasks = getAgentTasks(name)
                return (
                  <div key={name} className="border border-border rounded-lg overflow-hidden">
                    <Button
                      onClick={() => setExpandedAgent(expandedAgent === name ? null : name)}
                      variant="ghost"
                      className="w-full p-4 h-auto flex items-center justify-between text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-6">#{index + 1}</span>
                        <span className="font-medium text-foreground">{name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                          {t('sessionCount', { count: a.sessions.length })}
                        </span>
                        {agentTasks.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
                            {t('tasksTab', { count: agentTasks.length })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div className="font-medium text-foreground">{formatCost(a.stats.totalCost)}</div>
                          <div className="text-xs text-muted-foreground">{t('ofTotal', { pct: costShare.toFixed(1) })}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-muted-foreground">{formatNumber(a.stats.totalTokens)} {t('tokens')}</div>
                          <div className="text-xs text-muted-foreground">{t('reqs', { count: a.stats.requestCount })}</div>
                        </div>
                        <svg
                          className={`w-4 h-4 text-muted-foreground transition-transform ${expandedAgent === name ? 'rotate-180' : ''}`}
                          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                        >
                          <polyline points="4,6 8,10 12,6" />
                        </svg>
                      </div>
                    </Button>

                    {expandedAgent === name && (
                      <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                        {/* Tab switcher for expanded content */}
                        <div className="flex gap-2 pt-3 mb-3">
                          <Button
                            variant={expandedSection === 'tasks' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setExpandedSection('tasks') }}
                          >
                            {t('tasksTab', { count: agentTasks.length })}
                          </Button>
                          <Button
                            variant={expandedSection === 'models' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setExpandedSection('models') }}
                          >
                            {t('modelsTab', { count: Object.keys(a.models).length })}
                          </Button>
                        </div>

                        {expandedSection === 'tasks' && (
                          <div className="text-sm">
                            {agentTasks.length === 0 ? (
                              <div className="text-xs text-muted-foreground italic py-2">{t('noTaskCosts')}</div>
                            ) : (
                              <div className="space-y-1.5">
                                {agentTasks.map((task) => {
                                  const taskShare = ((task.stats.totalCost / Math.max(a.stats.totalCost, 0.0001)) * 100)
                                  return (
                                    <div key={task.taskId} className="flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                          task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                                          task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                                          task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                                          'bg-secondary text-muted-foreground'
                                        }`}>{task.priority}</span>
                                        {task.project.ticketRef && (
                                          <span className="text-muted-foreground font-mono">{task.project.ticketRef}</span>
                                        )}
                                        <span className="text-foreground truncate">{task.title}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                          task.status === 'done' ? 'bg-green-500/10 text-green-500' :
                                          task.status === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
                                          'bg-secondary text-muted-foreground'
                                        }`}>{task.status}</span>
                                      </div>
                                      <div className="flex gap-3 ml-2 shrink-0">
                                        <span className="text-muted-foreground">{taskShare.toFixed(0)}%</span>
                                        <span className="font-medium text-foreground w-16 text-right">{formatCost(task.stats.totalCost)}</span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {expandedSection === 'models' && (
                          <div className="text-sm">
                            <div className="space-y-1.5">
                              {Object.entries(a.models)
                                .sort(([, x], [, y]) => y.totalCost - x.totalCost)
                                .map(([model, stats]) => {
                                  const displayName = model.split('/').pop() || model
                                  return (
                                    <div key={model} className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">{displayName}</span>
                                      <div className="flex gap-4">
                                        <span>{formatNumber(stats.totalTokens)} {t('tokens')}</span>
                                        <span>{t('reqs', { count: stats.requestCount })}</span>
                                        <span className="font-medium text-foreground">{formatCost(stats.totalCost)}</span>
                                      </div>
                                    </div>
                                  )
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
