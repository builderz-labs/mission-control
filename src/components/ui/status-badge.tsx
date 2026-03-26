'use client'

type AgentStatus = 'running' | 'stopped' | 'crashed' | 'degraded' | 'idle' | 'busy' | 'offline' | 'unknown'

interface StatusBadgeProps {
  status: AgentStatus
  label?: string // Override the default label
  size?: 'sm' | 'md' // sm = 4px dot, md = 6px dot (default)
  showLabel?: boolean // default true
  className?: string
}

const STATUS_CONFIG: Record<AgentStatus, { color: string; defaultLabel: string }> = {
  running: { color: 'bg-[#22c55e]', defaultLabel: 'Running' },
  busy: { color: 'bg-[#f59e0b]', defaultLabel: 'Busy' },
  degraded: { color: 'bg-[#f59e0b]', defaultLabel: 'Degraded' },
  idle: { color: 'bg-[#71717a]', defaultLabel: 'Idle' },
  stopped: { color: 'bg-[#71717a]', defaultLabel: 'Stopped' },
  crashed: { color: 'bg-[#ef4444]', defaultLabel: 'Crashed' },
  offline: { color: 'bg-[#ef4444]', defaultLabel: 'Offline' },
  unknown: { color: 'bg-[#71717a]', defaultLabel: 'Unknown' },
}

export function StatusBadge({ status, label, size = 'md', showLabel = true, className = '' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown
  const dotSize = size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`${dotSize} rounded-full ${config.color} shrink-0`} />
      {showLabel && (
        <span className="text-xs text-[var(--text-secondary)]">
          {label || config.defaultLabel}
        </span>
      )}
    </span>
  )
}
