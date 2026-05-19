/* attach-os override — Apple Fitness-style cost hero */
'use client'
import { getBrandGradientText } from '@/lib/theme/brand-gradient'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

interface TrendPoint {
  timestamp: string
  cost: number
  tokens: number
  requests: number
}

interface CostHeroProps {
  totalCost: number
  requestCount: number
  totalTokens: number
  loading: boolean
  trends?: TrendPoint[]
}

export function CostHero({ totalCost, requestCount, totalTokens, loading, trends }: CostHeroProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading cost summary"
        className="rounded-2xl border border-border/50 bg-card p-6 mb-4 animate-pulse"
      >
        <div className="h-8 w-32 bg-muted rounded mb-2" />
        <div className="h-4 w-48 bg-muted/50 rounded" />
      </div>
    )
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(totalCost)

  // Sparkline: normalize bars to max cost
  const maxCost = trends && trends.length > 0
    ? Math.max(...trends.map(t => t.cost), 0.0001)
    : 1

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 mb-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
        Spend hoy
      </p>

      {/* Large cost figure — brand gradient text */}
      <p
        className="text-5xl font-semibold tracking-tight tabular-nums"
        style={getBrandGradientText()}
      >
        {formatted}
      </p>

      {/* Sub-stats row */}
      <div className="mt-3 flex gap-6 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground tabular-nums">{requestCount}</strong> requests
        </span>
        <span>
          <strong className="text-foreground tabular-nums">{formatTokens(totalTokens)}</strong> tokens
        </span>
      </div>

      {/* Sparkline */}
      {trends && trends.length > 0 && (
        <div
          data-testid="cost-sparkline"
          className="mt-4 flex items-end gap-0.5 h-10"
          aria-hidden="true"
        >
          {trends.map((t, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm opacity-70"
              style={{
                height: `${Math.max(8, Math.round((t.cost / maxCost) * 40))}px`,
                background: 'linear-gradient(135deg, #223ED7 0%, #56308E 100%)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}