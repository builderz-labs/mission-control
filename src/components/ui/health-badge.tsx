'use client'

import type { HealthStatus } from '@/lib/agent-health'

const STATUS_STYLES: Record<HealthStatus, { bg: string; pulse: boolean; label: string }> = {
  idle: { bg: 'bg-gray-400', pulse: false, label: 'Idle' },
  working: { bg: 'bg-green-400', pulse: false, label: 'Working' },
  stalled: { bg: 'bg-yellow-400', pulse: true, label: 'Stalled' },
  stuck: { bg: 'bg-red-400', pulse: true, label: 'Stuck' },
  zombie: { bg: 'bg-red-500', pulse: true, label: 'Zombie' },
  offline: { bg: 'bg-gray-600', pulse: false, label: 'Offline' },
}

interface HealthBadgeProps {
  status: HealthStatus
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

export function HealthBadge({ status, size = 'sm', showLabel = false, className = '' }: HealthBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.offline
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-block rounded-full ${sizeClass} ${style.bg} ${style.pulse ? 'animate-pulse' : ''}`}
        title={style.label}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
          {style.label}
        </span>
      )}
    </span>
  )
}
