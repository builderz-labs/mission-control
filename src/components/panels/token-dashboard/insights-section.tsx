'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import type { UsageStats, PerformanceMetrics, Alert } from './types'
import { formatNumber, formatCost, getModelDisplayName } from './formatters'

interface SessionInfo {
  id: string
  key?: string
  active?: boolean
}

interface InsightsSectionProps {
  readonly filteredUsageStats: UsageStats
  readonly performanceMetrics: PerformanceMetrics | null
  readonly alerts: Alert[]
  readonly isExporting: boolean
  readonly sessions: SessionInfo[]
  readonly onExportClientCsv: () => void
  readonly onExportData: (format: 'json' | 'csv') => void
}

export function InsightsSection({
  filteredUsageStats,
  performanceMetrics,
  alerts,
  isExporting,
  sessions,
  onExportClientCsv,
  onExportData,
}: InsightsSectionProps): JSX.Element {
  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Export Data</h2>
          <div className="flex space-x-2">
            <Button
              onClick={onExportClientCsv}
              disabled={isExporting}
              className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
            >
              {isExporting ? 'Exporting...' : 'Export CSV (Filtered)'}
            </Button>
            <Button
              onClick={() => onExportData('csv')}
              disabled={isExporting}
              className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
            >
              {isExporting ? 'Exporting...' : 'Export CSV (Full)'}
            </Button>
            <Button onClick={() => onExportData('json')} disabled={isExporting} variant="success">
              {isExporting ? 'Exporting...' : 'Export JSON'}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Export token usage data for analysis. &quot;Filtered&quot; exports only the currently displayed data;
          &quot;Full&quot; exports all records from the server.
        </p>
      </div>

      {/* Performance Insights */}
      {performanceMetrics && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Performance Insights</h2>

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
                    <div className="flex-shrink-0">{alert.type === 'warning' ? '!!' : 'i'}</div>
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

          <div className="mt-4">
            <h3 className="text-sm font-medium mb-3">Model Efficiency Comparison</h3>
            <div className="space-y-2">
              {Object.entries(filteredUsageStats?.models || {}).map(([model, stats]) => {
                const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens) * 1000
                const efficiency = 1 / costPerToken
                const maxEfficiency = Math.max(
                  ...Object.values(filteredUsageStats?.models || {}).map(
                    s => 1 / (s.totalCost / Math.max(1, s.totalTokens) * 1000),
                  ),
                )
                const barWidth = (efficiency / maxEfficiency) * 100
                return (
                  <div key={model} className="flex items-center text-sm">
                    <div className="w-32 truncate text-muted-foreground">{getModelDisplayName(model)}</div>
                    <div className="flex-1 mx-3">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${barWidth}%` }} />
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
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Model Performance</h2>
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
                      <div><div className="font-medium">{stats.requestCount}</div><div>Requests</div></div>
                      <div><div className="font-medium">{formatCost(avgCostPerRequest)}</div><div>Avg Cost</div></div>
                      <div><div className="font-medium">{formatNumber(avgTokensPerRequest)}</div><div>Avg Tokens</div></div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Top Sessions by Cost</h2>
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
                        <div className="font-medium text-foreground">{sessionInfo?.key || sessionId}</div>
                        <div className="text-xs text-muted-foreground">
                          {sessionInfo?.active ? 'Active' : 'Inactive'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-foreground">{formatCost(stats.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(stats.totalTokens)} tokens</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                      <div><div className="font-medium">{stats.requestCount}</div><div>Requests</div></div>
                      <div><div className="font-medium">{formatCost(avgCostPerRequest)}</div><div>Avg Cost</div></div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
