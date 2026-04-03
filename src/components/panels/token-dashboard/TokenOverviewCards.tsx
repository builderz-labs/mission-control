'use client'

import { useTranslations } from 'next-intl'
import { UsageStats, formatNumber, formatCost } from './token-dashboard-types'

interface CacheStats {
  cacheRead: number
  cacheWrite: number
}

interface TokenOverviewCardsProps {
  usageStats: UsageStats
  selectedTimeframe: string
  cacheStats: CacheStats | null
}

export function TokenOverviewCards({
  usageStats,
  selectedTimeframe,
  cacheStats,
}: TokenOverviewCardsProps): React.JSX.Element {
  const t = useTranslations('tokenDashboard')

  return (
    <div className={`grid grid-cols-1 gap-6 ${cacheStats ? 'md:grid-cols-6' : 'md:grid-cols-4'}`}>
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(usageStats.summary.totalTokens)}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('totalTokens', { timeframe: selectedTimeframe })}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatCost(usageStats.summary.totalCost)}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('totalCost', { timeframe: selectedTimeframe })}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(usageStats.summary.requestCount)}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('apiRequests')}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(usageStats.summary.avgTokensPerRequest)}
        </div>
        <div className="text-sm text-muted-foreground">
          {t('avgTokensPerRequest')}
        </div>
      </div>

      {cacheStats && (
        <>
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-3xl font-bold text-cyan-400">
              {formatNumber(cacheStats.cacheRead)}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('cacheReadTokens')}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-3xl font-bold text-amber-400">
              {formatNumber(cacheStats.cacheWrite)}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('cacheWriteTokens')}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
