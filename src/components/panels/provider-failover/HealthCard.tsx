'use client'

import { ProviderHealth } from './types'

interface HealthCardProps {
  health: ProviderHealth
}

// Map success rate to a Tailwind color class (green >90%, amber 70-90%, red <70%)
function getHealthColor(successRate: number): string {
  if (successRate > 90) return 'bg-green-500'
  if (successRate >= 70) return 'bg-amber-500'
  return 'bg-red-500'
}

function getHealthTextColor(successRate: number): string {
  if (successRate > 90) return 'text-green-400'
  if (successRate >= 70) return 'text-amber-400'
  return 'text-red-400'
}

export function HealthCard({ health }: HealthCardProps): React.JSX.Element {
  const colorClass = getHealthColor(health.successRate)
  const textColorClass = getHealthTextColor(health.successRate)

  const lastChecked = health.lastChecked
    ? new Date(health.lastChecked * 1000).toLocaleTimeString()
    : 'never'

  const truncatedError =
    health.lastError && health.lastError.length > 80
      ? `${health.lastError.slice(0, 80)}…`
      : health.lastError

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${colorClass}`} />
          <span className="font-medium capitalize text-sm">{health.provider}</span>
        </div>
        {health.avgLatency !== null && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {health.avgLatency}ms avg
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-2">Last checked: {lastChecked}</p>

      {/* Success rate progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Success rate</span>
          <span className={textColorClass}>{health.successRate}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${colorClass}`}
            style={{ width: `${health.successRate}%` }}
          />
        </div>
      </div>

      {truncatedError && (
        <p className="text-xs text-red-400 truncate" title={health.lastError ?? ''}>
          {truncatedError}
        </p>
      )}
    </div>
  )
}
