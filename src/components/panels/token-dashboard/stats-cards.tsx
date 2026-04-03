'use client'

import type { JSX } from 'react'
import type { UsageStats } from './types'
import { formatNumber, formatCost } from './formatters'

interface StatsCardsProps {
  readonly stats: UsageStats
  readonly selectedTimeframe: string
  readonly cacheStats: { cacheRead: number; cacheWrite: number } | null
}

export function StatsCards({ stats, selectedTimeframe, cacheStats }: StatsCardsProps): JSX.Element {
  return (
    <div className={`grid grid-cols-1 gap-6 ${cacheStats ? 'md:grid-cols-6' : 'md:grid-cols-4'}`}>
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(stats.summary.totalTokens)}
        </div>
        <div className="text-sm text-muted-foreground">
          Total Tokens ({selectedTimeframe})
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatCost(stats.summary.totalCost)}
        </div>
        <div className="text-sm text-muted-foreground">
          Total Cost ({selectedTimeframe})
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(stats.summary.requestCount)}
        </div>
        <div className="text-sm text-muted-foreground">API Requests</div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-3xl font-bold text-foreground">
          {formatNumber(stats.summary.avgTokensPerRequest)}
        </div>
        <div className="text-sm text-muted-foreground">Avg Tokens/Request</div>
      </div>

      {cacheStats && (
        <>
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-3xl font-bold text-cyan-400">
              {formatNumber(cacheStats.cacheRead)}
            </div>
            <div className="text-sm text-muted-foreground">Cache Read Tokens</div>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-3xl font-bold text-amber-400">
              {formatNumber(cacheStats.cacheWrite)}
            </div>
            <div className="text-sm text-muted-foreground">Cache Write Tokens</div>
          </div>
        </>
      )}
    </div>
  )
}
