'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  UsageStats,
  PerformanceMetrics,
  AlertEntry,
  SessionCostEntry,
  COLORS,
  PROVIDER_COLORS,
  formatNumber,
  formatCost,
  getModelDisplayName,
} from './token-dashboard-types'
import { detectProvider } from '@/lib/token-utils'

interface Session {
  id: string
  key?: string
  active?: boolean
}

interface TokenModelBreakdownProps {
  filteredUsageStats: UsageStats
  sessions: Session[]
  performanceMetrics: PerformanceMetrics | null
  alerts: AlertEntry[]
  isExporting: boolean
  onExportClientCsv: () => void
  onExportData: (format: 'json' | 'csv') => void
}

function prepareModelChartData(filteredUsageStats: UsageStats) {
  return Object.entries(filteredUsageStats.models)
    .map(([model, stats]) => ({
      name: getModelDisplayName(model),
      tokens: stats.totalTokens,
      cost: stats.totalCost,
      requests: stats.requestCount,
    }))
    .sort((a, b) => b.cost - a.cost)
}

function preparePieChartData(filteredUsageStats: UsageStats) {
  return Object.entries(filteredUsageStats.models)
    .map(([model, stats]) => ({
      name: getModelDisplayName(model),
      value: stats.totalCost,
      tokens: stats.totalTokens,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
}

function prepareProviderPieData(filteredUsageStats: UsageStats) {
  const providerMap: Record<string, { cost: number; tokens: number }> = {}
  for (const [model, stats] of Object.entries(filteredUsageStats.models)) {
    const provider = detectProvider(model)
    if (!providerMap[provider]) providerMap[provider] = { cost: 0, tokens: 0 }
    providerMap[provider].cost += stats.totalCost
    providerMap[provider].tokens += stats.totalTokens
  }
  return Object.entries(providerMap)
    .map(([name, data]) => ({ name, value: data.cost, tokens: data.tokens }))
    .sort((a, b) => b.value - a.value)
}

export function TokenModelBreakdown({
  filteredUsageStats,
  sessions,
  performanceMetrics,
  alerts,
  isExporting,
  onExportClientCsv,
  onExportData,
}: TokenModelBreakdownProps): React.JSX.Element {
  const t = useTranslations('tokenDashboard')

  const modelChartData = prepareModelChartData(filteredUsageStats)
  const pieChartData = preparePieChartData(filteredUsageStats)
  const providerPieData = prepareProviderPieData(filteredUsageStats)

  return (
    <>
      {/* Charts Section */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Model Usage Bar Chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('tokenUsageByModel')}</h2>
          <div className="h-64">
            {modelChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noModelUsageData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                  <YAxis />
                  <Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} />
                  <Bar dataKey="tokens" fill="#8884d8" name={t('chartTokens')} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Cost Distribution Pie Chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('costDistributionByModel')}</h2>
          <div className="h-64">
            {pieChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieChartData.map((_, index) => (
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

        {/* Cost by Provider Pie Chart */}
        <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4">{t('costByProvider')}</h2>
          <div className="h-64">
            {providerPieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noProviderData')}</div>
            ) : (
              <div className="flex h-full">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={providerPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {providerPieData.map((entry) => (
                          <Cell key={entry.name} fill={PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCost(Number(value))} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-48 flex flex-col justify-center space-y-2">
                  {providerPieData.map(entry => (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other }}
                        />
                        <span className="text-muted-foreground">{entry.name}</span>
                      </div>
                      <span className="text-foreground font-medium">{formatCost(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{t('exportData')}</h2>
          <div className="flex space-x-2">
            <Button
              onClick={onExportClientCsv}
              disabled={isExporting}
              className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
            >
              {isExporting ? t('exporting') : t('exportCsvFiltered')}
            </Button>
            <Button
              onClick={() => onExportData('csv')}
              disabled={isExporting}
              className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
            >
              {isExporting ? t('exporting') : t('exportCsvFull')}
            </Button>
            <Button
              onClick={() => onExportData('json')}
              disabled={isExporting}
              variant="success"
            >
              {isExporting ? t('exporting') : t('exportJson')}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Export token usage data for analysis. &quot;Filtered&quot; exports only the currently displayed data; &quot;Full&quot; exports all records from the server.
        </p>
      </div>

      {/* Performance Insights */}
      {performanceMetrics && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('performanceInsights')}</h2>

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
                      {alert.type === 'warning' ? '!!' : 'i'}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-secondary rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('mostEfficientModel')}</h3>
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                {getModelDisplayName(performanceMetrics.mostEfficient.model)}
              </div>
              <div className="text-xs text-muted-foreground">
                ${(performanceMetrics.mostEfficient.stats.totalCost / Math.max(1, performanceMetrics.mostEfficient.stats.totalTokens) * 1000).toFixed(4)}/1K tokens
              </div>
            </div>

            <div className="bg-secondary rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('mostUsedModel')}</h3>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {getModelDisplayName(performanceMetrics.mostUsed.model)}
              </div>
              <div className="text-xs text-muted-foreground">
                {performanceMetrics.mostUsed.stats.requestCount} requests
              </div>
            </div>

            <div className="bg-secondary rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('optimizationPotential')}</h3>
              <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                {formatCost(performanceMetrics.potentialSavings)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('savingsPossible', { pct: performanceMetrics.savingsPercentage.toFixed(1) })}
              </div>
            </div>
          </div>

          {/* Model Efficiency Comparison */}
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-3">{t('modelEfficiencyComparison')}</h3>
            <div className="space-y-2">
              {Object.entries(filteredUsageStats.models).map(([model, stats]) => {
                const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens) * 1000
                const efficiency = 1 / costPerToken
                const maxEfficiency = Math.max(
                  ...Object.values(filteredUsageStats.models).map(s => 1 / (s.totalCost / Math.max(1, s.totalTokens) * 1000))
                )
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
                        />
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
          <h2 className="text-xl font-semibold mb-4">{t('modelPerformance')}</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {Object.entries(filteredUsageStats.models)
              .sort(([, a], [, b]) => b.totalCost - a.totalCost)
              .map(([model, stats]) => {
                const avgCostPerRequest = stats.totalCost / Math.max(1, stats.requestCount)
                const avgTokensPerRequest = stats.totalTokens / Math.max(1, stats.requestCount)

                return (
                  <div key={model} className="p-3 bg-secondary rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-foreground">{getModelDisplayName(model)}</div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-foreground">{formatCost(stats.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(stats.totalTokens)} tokens</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                      <div>
                        <div className="font-medium">{stats.requestCount}</div>
                        <div>{t('requestsLabel')}</div>
                      </div>
                      <div>
                        <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                        <div>{t('avgCost')}</div>
                      </div>
                      <div>
                        <div className="font-medium">{formatNumber(avgTokensPerRequest)}</div>
                        <div>{t('avgTokens')}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Session Statistics */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('topSessionsByCost')}</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {Object.entries(filteredUsageStats.sessions)
              .sort(([, a], [, b]) => b.totalCost - a.totalCost)
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
                          {sessionInfo?.active ? t('sessionActive') : t('sessionInactive')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-foreground">{formatCost(stats.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(stats.totalTokens)} tokens</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                      <div>
                        <div className="font-medium">{stats.requestCount}</div>
                        <div>{t('requestsLabel')}</div>
                      </div>
                      <div>
                        <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                        <div>{t('avgCost')}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </>
  )
}
