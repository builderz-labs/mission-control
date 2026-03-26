'use client'

type ConnectionState = 'connected' | 'offline' | 'degraded'

interface ConnectionPillProps {
  state: ConnectionState
  queuedCount?: number // shown when offline
  latency?: number // shown when connected, in ms
  className?: string
}

const PILL_CONFIG: Record<ConnectionState, { dot: string; text: string; label: string }> = {
  connected: { dot: 'bg-[#22c55e]', text: 'text-[#22c55e]', label: 'MC Connected' },
  offline: { dot: 'bg-[#ef4444]', text: 'text-[#ef4444]', label: 'MC Offline' },
  degraded: { dot: 'bg-[#f59e0b]', text: 'text-[#f59e0b]', label: 'MC Degraded' },
}

export function ConnectionPill({ state, queuedCount, latency, className = '' }: ConnectionPillProps) {
  const config = PILL_CONFIG[state]

  let displayLabel = config.label
  if (state === 'offline' && queuedCount != null && queuedCount > 0) {
    displayLabel = `MC Offline (${queuedCount} queued)`
  }
  if (state === 'connected' && latency != null) {
    displayLabel = `MC Connected · ${latency}ms`
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} shrink-0`} />
      <span className={`text-xs font-medium font-mono ${config.text}`}>
        {displayLabel}
      </span>
    </div>
  )
}
