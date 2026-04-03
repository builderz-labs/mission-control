// Chart data preparation and analytics helpers — pure functions, no React state

import { detectProvider } from '@/lib/token-utils'
import type { UsageStats, TrendData, PerformanceMetrics, Alert, TimezoneOption } from './types'
import { PROVIDER_COLORS } from './constants'
import { formatCost, formatTimestamp, getModelDisplayName } from './formatters'

export function prepareModelChartData(
  models: UsageStats['models'],
): Array<{ name: string; tokens: number; cost: number; requests: number }> {
  return Object.entries(models)
    .map(([model, stats]) => ({
      name: getModelDisplayName(model),
      tokens: stats.totalTokens,
      cost: stats.totalCost,
      requests: stats.requestCount,
    }))
    .sort((a, b) => b.cost - a.cost)
}

export function preparePieChartData(
  models: UsageStats['models'],
): Array<{ name: string; value: number; tokens: number }> {
  return Object.entries(models)
    .map(([model, stats]) => ({
      name: getModelDisplayName(model),
      value: stats.totalCost,
      tokens: stats.totalTokens,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
}

export function prepareProviderPieData(
  models: UsageStats['models'],
): Array<{ name: string; value: number; tokens: number }> {
  const providerMap: Record<string, { cost: number; tokens: number }> = {}
  for (const [model, stats] of Object.entries(models)) {
    const provider = detectProvider(model)
    if (!providerMap[provider]) providerMap[provider] = { cost: 0, tokens: 0 }
    providerMap[provider].cost += stats.totalCost
    providerMap[provider].tokens += stats.totalTokens
  }
  return Object.entries(providerMap)
    .map(([name, data]) => ({ name, value: data.cost, tokens: data.tokens }))
    .sort((a, b) => b.value - a.value)
}

export function prepareTrendChartData(
  trendData: TrendData | null,
  chartMode: 'incremental' | 'cumulative',
  timezone: TimezoneOption,
): Array<{ time: string; tokens: number; cost: number; requests: number }> {
  if (!trendData?.trends) return []
  const raw = trendData.trends.map(trend => ({
    time: formatTimestamp(trend.timestamp, timezone),
    tokens: trend.tokens,
    cost: trend.cost,
    requests: trend.requests,
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

export function getPeakTrendHour(
  trendData: TrendData | null,
  timezone: TimezoneOption,
): string | null {
  if (!trendData?.trends || trendData.trends.length === 0) return null
  let peak = trendData.trends[0]
  for (const t of trendData.trends) {
    if (t.requests > peak.requests) peak = t
  }
  return formatTimestamp(peak.timestamp, timezone)
}

export function getPerformanceMetrics(
  filteredUsageStats: UsageStats | null,
): PerformanceMetrics | null {
  if (!filteredUsageStats?.models) return null
  const models = Object.entries(filteredUsageStats.models)
  if (models.length === 0) return null

  let mostEfficient = { model: models[0][0], stats: models[0][1] }
  let mostUsed = { model: models[0][0], stats: models[0][1] }
  let mostExpensive = { model: models[0][0], stats: models[0][1] }

  for (const [model, stats] of models) {
    const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens)
    const efficientCpt = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
    const expensiveCpt = mostExpensive.stats.totalCost / Math.max(1, mostExpensive.stats.totalTokens)
    if (costPerToken < efficientCpt) mostEfficient = { model, stats }
    if (costPerToken > expensiveCpt) mostExpensive = { model, stats }
    if (stats.requestCount > mostUsed.stats.requestCount) mostUsed = { model, stats }
  }

  const totalTokens = filteredUsageStats.summary.totalTokens
  const currentCost = filteredUsageStats.summary.totalCost
  const efficientCostPerToken = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
  const potentialCost = totalTokens * efficientCostPerToken
  const potentialSavings = Math.max(0, currentCost - potentialCost)

  return {
    mostEfficient,
    mostUsed,
    mostExpensive,
    potentialSavings,
    savingsPercentage: currentCost > 0 ? (potentialSavings / currentCost) * 100 : 0,
  }
}

export function getAlerts(
  filteredUsageStats: UsageStats | null,
  performanceMetrics: PerformanceMetrics | null,
): Alert[] {
  const alerts: Alert[] = []

  if (
    filteredUsageStats &&
    filteredUsageStats.summary.totalCost !== undefined &&
    filteredUsageStats.summary.totalCost > 100
  ) {
    alerts.push({
      type: 'warning',
      title: 'High Usage Cost',
      message: `Total cost of ${formatCost(filteredUsageStats.summary.totalCost)} exceeds $100 threshold`,
      suggestion: 'Consider using more cost-effective models for routine tasks',
    })
  }

  if (performanceMetrics && performanceMetrics.savingsPercentage > 20) {
    alerts.push({
      type: 'info',
      title: 'Optimization Opportunity',
      message: `Using ${getModelDisplayName(performanceMetrics.mostEfficient.model)} could save ${formatCost(performanceMetrics.potentialSavings)} (${performanceMetrics.savingsPercentage.toFixed(1)}%)`,
      suggestion: 'Consider switching routine tasks to more efficient models',
    })
  }

  if (
    filteredUsageStats &&
    filteredUsageStats.summary.requestCount !== undefined &&
    filteredUsageStats.summary.requestCount > 1000
  ) {
    alerts.push({
      type: 'info',
      title: 'High Request Volume',
      message: `${filteredUsageStats.summary.requestCount} requests in selected timeframe`,
      suggestion: 'Consider implementing request batching or caching for efficiency',
    })
  }

  return alerts
}

// Re-export so consumers can import from one place
export { PROVIDER_COLORS }
