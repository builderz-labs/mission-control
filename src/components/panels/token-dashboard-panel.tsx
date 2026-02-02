'use client'

import { useState, useEffect } from 'react'
import { useMissionControl } from '@/store'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

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

export function TokenDashboardPanel() {
  const { sessions } = useMissionControl()

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    loadUsageStats()
    loadTrendData()
  }, [selectedTimeframe])

  const loadUsageStats = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tokens?action=stats&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setUsageStats(data)
    } catch (error) {
      console.error('Failed to load usage stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadTrendData = async () => {
    try {
      const response = await fetch(`/api/tokens?action=trends&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setTrendData(data)
    } catch (error) {
      console.error('Failed to load trend data:', error)
    }
  }

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
      console.error('Export failed:', error)
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
    return trendData.trends.map(trend => ({
      time: new Date(trend.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tokens: trend.tokens,
      cost: trend.cost,
      requests: trend.requests
    }))
  }

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
    
    if (usageStats?.summary.totalCost > 100) {
      alerts.push({
        type: 'warning',
        title: 'High Usage Cost',
        message: `Total cost of ${formatCost(usageStats.summary.totalCost)} exceeds $100 threshold`,
        suggestion: 'Consider using more cost-effective models for routine tasks'
      })
    }

    if (performanceMetrics?.savingsPercentage > 20) {
      alerts.push({
        type: 'info',
        title: 'Optimization Opportunity',
        message: `Using ${getModelDisplayName(performanceMetrics.mostEfficient.model)} could save ${formatCost(performanceMetrics.potentialSavings)} (${performanceMetrics.savingsPercentage.toFixed(1)}%)`,
        suggestion: 'Consider switching routine tasks to more efficient models'
      })
    }

    if (usageStats?.summary.requestCount > 1000) {
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
          <div className="flex space-x-2">
            {(['hour', 'day', 'week', 'month'] as const).map((timeframe) => (
              <button
                key={timeframe}
                onClick={() => setSelectedTimeframe(timeframe)}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                  selectedTimeframe === timeframe
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                }`}
              >
                {timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
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
              <h2 className="text-xl font-semibold mb-4">Usage Trends (Last 24h)</h2>
              <div className="h-64">
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
              </div>
            </div>

            {/* Model Usage Bar Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Token Usage by Model</h2>
              <div className="h-64">
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
              </div>
            </div>

            {/* Cost Distribution Pie Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Cost Distribution by Model</h2>
              <div className="h-64">
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
              </div>
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Export Data</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => exportData('csv')}
                  disabled={isExporting}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {isExporting ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  onClick={() => exportData('json')}
                  disabled={isExporting}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 transition-colors"
                >
                  {isExporting ? 'Exporting...' : 'Export JSON'}
                </button>
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
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
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
          <button 
            onClick={loadUsageStats}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}