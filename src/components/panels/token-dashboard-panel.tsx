'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

const log = createClientLogger('TokenDashboard')

interface UsageStats {
  summary: {
    totalTokens: number
    totalCost: number
    requestCount: number
    avgTokensPerRequest: number
    avgCostPerRequest: number
  }
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

type DashboardView = 'overview' | 'sessions'

interface SessionCostEntry {
  sessionId: string
  sessionKey?: string
  model: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
  firstSeen: string
  lastSeen: string
}

export function TokenDashboardPanel() {
  const { sessions } = useMissionControl()

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [view, setView] = useState<DashboardView>('overview')
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')

  const loadUsageStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tokens?action=stats&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setUsageStats(data)
    } catch (error) {
      log.error('Failed to load usage stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  const loadTrendData = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=trends&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setTrendData(data)
    } catch (error) {
      log.error('Failed to load trend data:', error)
    }
  }, [selectedTimeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=session-costs&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        // Fallback: derive from existing stats
        const entries: SessionCostEntry[] = Object.entries(usageStats.sessions).map(([sessionId, stats]) => {
          const info = sessions.find(s => s.id === sessionId)
          return {
            sessionId,
            sessionKey: info?.key,
            model: '',
            totalTokens: stats.totalTokens,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: stats.totalCost,
            requestCount: stats.requestCount,
            firstSeen: '',
            lastSeen: '',
          }
        })
        setSessionCosts(entries)
      }
    } catch {
      // Use fallback from usageStats if available
      if (usageStats?.sessions) {
        const entries: SessionCostEntry[] = Object.entries(usageStats.sessions).map(([sessionId, stats]) => {
          const info = sessions.find(s => s.id === sessionId)
          return {
            sessionId,
            sessionKey: info?.key,
            model: '',
            totalTokens: stats.totalTokens,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: stats.totalCost,
            requestCount: stats.requestCount,
            firstSeen: '',
            lastSeen: '',
          }
        })
        setSessionCosts(entries)
      }
    }
  }, [selectedTimeframe, usageStats, sessions])

  useEffect(() => {
    loadUsageStats()
    loadTrendData()
  }, [loadUsageStats, loadTrendData])

  useEffect(() => {
    if (view === 'sessions') loadSessionCosts()
  }, [view, loadSessionCosts])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/tokens?action=export&timeframe=${selectedTimeframe}&format=${format}`)
      
      if (!response.ok) {
        throw new Error('Export failed')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `token-usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      log.error('Export failed:', error)
      alert('Export failed: ' + error)
    } finally {
      setIsExporting(false)
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  const formatCost = (cost: number) => {
    return '$' + cost.toFixed(4)
  }

  const getModelDisplayName = (modelName: string) => {
    const parts = modelName.split('/')
    return parts[parts.length - 1] || modelName
  }

  const prepareModelChartData = () => {
    if (!usageStats?.models) return []
    return Object.entries(usageStats.models)
      .map(([model, stats]) => ({
        name: getModelDisplayName(model),
        tokens: stats.totalTokens,
        cost: stats.totalCost,
        requests: stats.requestCount
      }))
      .sort((a, b) => b.cost - a.cost)
  }

  const preparePieChartData = () => {
    if (!usageStats?.models) return []
    const data = Object.entries(usageStats.models)
      .map(([model, stats]) => ({
        name: getModelDisplayName(model),
        value: stats.totalCost,
        tokens: stats.totalTokens
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6) // Top 6 models
    
    return data
  }

  const prepareTrendChartData = () => {
    if (!trendData?.trends) return []
    const raw = trendData.trends.map(trend => ({
      time: new Date(trend.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tokens: trend.tokens,
      cost: trend.cost,
      requests: trend.requests
    }))

    if (chartMode === 'cumulative') {
      let cumTokens = 0
      let cumCost = 0
      let cumRequests = 0
      return raw.map(d => {
        cumTokens += d.tokens
        cumCost += d.cost
        cumRequests += d.requests
        return { ...d, tokens: cumTokens, cost: cumCost, requests: cumRequests }
      })
    }

    return raw
  }

  const sortedSessionCosts = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

  // Enhanced performance metrics
  const getPerformanceMetrics = () => {
    if (!usageStats?.models) return null

    const models = Object.entries(usageStats.models)
    if (models.length === 0) return null

    // Find most cost-effective model (lowest cost per token)
    let mostEfficient = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens)
      const bestCostPerToken = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
      if (costPerToken < bestCostPerToken) {
        mostEfficient = { model, stats }
      }
    }

    // Find most used model
    let mostUsed = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      if (stats.requestCount > mostUsed.stats.requestCount) {
        mostUsed = { model, stats }
      }
    }

    // Find most expensive model
    let mostExpensive = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens)
      const bestCostPerToken = mostExpensive.stats.totalCost / Math.max(1, mostExpensive.stats.totalTokens)
      if (costPerToken > bestCostPerToken) {
        mostExpensive = { model, stats }
      }
    }

    // Calculate potential savings
    const totalTokens = usageStats.summary.totalTokens
    const currentCost = usageStats.summary.totalCost
    const efficientCostPerToken = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
    const potentialCost = totalTokens * efficientCostPerToken
    const potentialSavings = Math.max(0, currentCost - potentialCost)

    return {
      mostEfficient,
      mostUsed,
      mostExpensive,
      potentialSavings,
      savingsPercentage: currentCost > 0 ? (potentialSavings / currentCost) * 100 : 0
    }
  }

  const performanceMetrics = getPerformanceMetrics()

  // Alert conditions
  const getAlerts = () => {
    const alerts = []
    
    if (usageStats && usageStats.summary.totalCost !== undefined && usageStats.summary.totalCost > 100) {
      alerts.push({
        type: 'warning',
        title: 'High Usage Cost',
        message: `Total cost of ${formatCost(usageStats.summary.totalCost)} exceeds $100 threshold`,
        suggestion: 'Consider using more cost-effective models for routine tasks'
      })
    }

    if (performanceMetrics && performanceMetrics.savingsPercentage !== undefined && performanceMetrics.savingsPercentage > 20) {
      alerts.push({
        type: 'info',
        title: 'Optimization Opportunity',
        message: `Using ${getModelDisplayName(performanceMetrics.mostEfficient.model)} could save ${formatCost(performanceMetrics.potentialSavings)} (${performanceMetrics.savingsPercentage.toFixed(1)}%)`,
        suggestion: 'Consider switching routine tasks to more efficient models'
      })
    }

    if (usageStats && usageStats.summary.requestCount !== undefined && usageStats.summary.requestCount > 1000) {
      alerts.push({
        type: 'info',
        title: 'High Request Volume',
        message: `${usageStats.summary.requestCount} requests in selected timeframe`,
        suggestion: 'Consider implementing request batching or caching for efficiency'
      })
    }

    return alerts
  }

  const alerts = getAlerts()

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Token & Cost Dashboard</h1>
            <p className="text-muted-foreground mt-2">
              Monitor token usage and costs across models and sessions
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView('overview')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'overview' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Overview
              </button>
              <button
                onClick={() => setView('sessions')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'sessions' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Sessions
              </button>
            </div>
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map((timeframe) => (
                <Button
                  key={timeframe}
                  onClick={() => setSelectedTimeframe(timeframe)}
                  variant={selectedTimeframe === timeframe ? 'default' : 'secondary'}
                >
                  {timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {view === 'sessions' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Sort by:</span>
            {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSessionSort(s)}
                className={`px-2 py-1 text-xs rounded ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {sortedSessionCosts.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-lg mb-1">No session cost data</p>
              <p className="text-sm">Session-level breakdowns appear once usage is recorded.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSessionCosts.map((entry) => {
                const sessionInfo = sessions.find(s => s.id === entry.sessionId)
                return (
                  <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {sessionInfo?.active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                          <span>{sessionInfo?.active ? 'Active' : 'Inactive'}</span>
                          {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                          {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                      <div><span className="font-medium text-foreground">{entry.requestCount}</span> requests</div>
                      <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> in</div>
                      <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> out</div>
                      <div>
                        {entry.totalTokens > 0
                          ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span>
                          : '-'
                        }{' '}avg/req
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-3 text-muted-foreground">Loading usage data...</span>
        </div>
      ) : usageStats ? (
        <div className="space-y-6">
          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(usageStats.summary.totalTokens)}
              </div>
              <div className="text-sm text-muted-foreground">
                Total Tokens ({selectedTimeframe})
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatCost(usageStats.summary.totalCost)}
              </div>
              <div className="text-sm text-muted-foreground">
                Total Cost ({selectedTimeframe})
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(usageStats.summary.requestCount)}
              </div>
              <div className="text-sm text-muted-foreground">
                API Requests
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(usageStats.summary.avgTokensPerRequest)}
              </div>
              <div className="text-sm text-muted-foreground">
                Avg Tokens/Request
              </div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Usage Trends Chart */}
            <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Usage Trends ({selectedTimeframe})</h2>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setChartMode('incremental')}
                    className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'incremental' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                  >
                    Per-Turn
                  </button>
                  <button
                    onClick={() => setChartMode('cumulative')}
                    className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'cumulative' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                  >
                    Cumulative
                  </button>
                </div>
              </div>
              <div className="h-64">
                {prepareTrendChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No trend data for this timeframe</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prepareTrendChartData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="tokens" 
                      stroke="#8884d8" 
                      strokeWidth={2} 
                      name="Tokens"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="requests" 
                      stroke="#82ca9d" 
                      strokeWidth={2} 
                      name="Requests"
                    />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Model Usage Bar Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Token Usage by Model</h2>
              <div className="h-64">
                {prepareModelChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No model usage data yet</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={prepareModelChartData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45} 
                      textAnchor="end" 
                      height={80}
                      interval={0}
                    />
                    <YAxis />
                    <Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} />
                    <Bar dataKey="tokens" fill="#8884d8" name="Tokens" />
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Cost Distribution Pie Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Cost Distribution by Model</h2>
              <div className="h-64">
                {preparePieChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No cost data yet</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={preparePieChartData()}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {preparePieChartData().map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCost(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Export Data</h2>
              <div className="flex space-x-2">
                <Button
                  onClick={() => exportData('csv')}
                  disabled={isExporting}
                  className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                >
                  {isExporting ? 'Exporting...' : 'Export CSV'}
                </Button>
                <Button
                  onClick={() => exportData('json')}
                  disabled={isExporting}
                  variant="success"
                >
                  {isExporting ? 'Exporting...' : 'Export JSON'}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Export token usage data for analysis. Includes detailed usage records, model statistics, and cost breakdowns.
            </p>
          </div>

          {/* Performance Insights */}
          {performanceMetrics && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Performance Insights</h2>
              
              {/* Alerts */}
              {alerts.length > 0 && (
                <div className="mb-6 space-y-3">
                  {alerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`border-l-4 p-4 rounded ${
                        alert.type === 'warning' 
                          ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' 
                          : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      }`}
                    >
                      <div className="flex items-start">
                        <div className="flex-shrink-0">
                          {alert.type === 'warning' ? '⚠️' : 'ℹ️'}
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">{alert.suggestion}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Performance Metrics Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Most Efficient Model</h3>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">
                    {getModelDisplayName(performanceMetrics.mostEfficient.model)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(performanceMetrics.mostEfficient.stats.totalCost / Math.max(1, performanceMetrics.mostEfficient.stats.totalTokens) * 1000).toFixed(4)}/1K tokens
                  </div>
                </div>

                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Most Used Model</h3>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                    {getModelDisplayName(performanceMetrics.mostUsed.model)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {performanceMetrics.mostUsed.stats.requestCount} requests
                  </div>
                </div>

                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Optimization Potential</h3>
                  <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                    {formatCost(performanceMetrics.potentialSavings)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {performanceMetrics.savingsPercentage.toFixed(1)}% savings possible
                  </div>
                </div>
              </div>

              {/* Model Efficiency Comparison */}
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-3">Model Efficiency Comparison</h3>
                <div className="space-y-2">
                  {Object.entries(usageStats?.models || {})
                    .map(([model, stats]) => {
                      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens) * 1000
                      const efficiency = 1 / costPerToken // Higher is better
                      const maxEfficiency = Math.max(...Object.values(usageStats?.models || {}).map(s => 1 / (s.totalCost / Math.max(1, s.totalTokens) * 1000)))
                      const barWidth = (efficiency / maxEfficiency) * 100

                      return (
                        <div key={model} className="flex items-center text-sm">
                          <div className="w-32 truncate text-muted-foreground">
                            {getModelDisplayName(model)}
                          </div>
                          <div className="flex-1 mx-3">
                            <div className="w-full bg-secondary rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full"
                                style={{ width: `${barWidth}%` }}
                              ></div>
                            </div>
                          </div>
                          <div className="w-20 text-right text-xs text-muted-foreground">
                            ${costPerToken.toFixed(4)}/1K
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Detailed Statistics */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Model Statistics */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Model Performance</h2>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Object.entries(usageStats.models)
                  .sort(([,a], [,b]) => b.totalCost - a.totalCost)
                  .map(([model, stats]) => {
                    const avgCostPerRequest = stats.totalCost / Math.max(1, stats.requestCount)
                    const avgTokensPerRequest = stats.totalTokens / Math.max(1, stats.requestCount)
                    
                    return (
                      <div key={model} className="p-3 bg-secondary rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-foreground">
                            {getModelDisplayName(model)}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-foreground">
                              {formatCost(stats.totalCost)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatNumber(stats.totalTokens)} tokens
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                          <div>
                            <div className="font-medium">{stats.requestCount}</div>
                            <div>Requests</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                            <div>Avg Cost</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatNumber(avgTokensPerRequest)}</div>
                            <div>Avg Tokens</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Session Statistics */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Top Sessions by Cost</h2>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Object.entries(usageStats.sessions)
                  .sort(([,a], [,b]) => b.totalCost - a.totalCost)
                  .slice(0, 10)
                  .map(([sessionId, stats]) => {
                    const sessionInfo = sessions.find(s => s.id === sessionId)
                    const avgCostPerRequest = stats.totalCost / Math.max(1, stats.requestCount)
                    
                    return (
                      <div key={sessionId} className="p-3 bg-secondary rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="font-medium text-foreground">
                              {sessionInfo?.key || sessionId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {sessionInfo?.active ? 'Active' : 'Inactive'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-foreground">
                              {formatCost(stats.totalCost)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatNumber(stats.totalTokens)} tokens
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                          <div>
                            <div className="font-medium">{stats.requestCount}</div>
                            <div>Requests</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                            <div>Avg Cost</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">No usage data available</div>
          <div className="text-sm">Token usage will appear here once agents start running</div>
          <Button
            onClick={loadUsageStats}
            className="mt-4"
          >
            Refresh
          </Button>
        </div>
      )}
    </div>
  )
}
