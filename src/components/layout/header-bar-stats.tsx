'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { getNavigationMetrics, navigationMetricEventName } from '@/lib/navigation-metrics'

interface StatProps {
  label: string
  value: string
  status?: 'success' | 'error' | 'warning'
}

export function Stat({ label, value, status }: StatProps): React.ReactElement {
  const statusColor =
    status === 'success' ? 'text-green-400' :
    status === 'error' ? 'text-red-400' :
    status === 'warning' ? 'text-amber-400' :
    'text-foreground'

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium font-mono-tight ${statusColor}`}>{value}</span>
    </div>
  )
}

export function NavigationLatencyStat(): React.ReactElement | null {
  const [latestMs, setLatestMs] = useState<number | null>(null)
  const [avgMs, setAvgMs] = useState<number | null>(null)

  useEffect(() => {
    const initial = getNavigationMetrics()
    setLatestMs(initial.latestMs)
    setAvgMs(initial.avgMs)

    const eventName = navigationMetricEventName()
    const update = (): void => {
      const metrics = getNavigationMetrics()
      setLatestMs(metrics.latestMs)
      setAvgMs(metrics.avgMs)
    }
    window.addEventListener(eventName, update as EventListener)
    return () => window.removeEventListener(eventName, update as EventListener)
  }, [])

  if (latestMs == null) return null
  const latest = `${Math.round(latestMs)}ms`
  const avg = avgMs == null ? '' : ` (${Math.round(avgMs)} avg)`
  return <Stat label="Nav" value={`${latest}${avg}`} />
}

interface SseBadgeProps {
  connected: boolean
}

export function SseBadge({ connected }: SseBadgeProps): React.ReactElement {
  const th = useTranslations('header')
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{th('events')}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-blue-500' : 'bg-muted-foreground/30'}`} />
      <span className={`font-medium font-mono-tight ${connected ? 'text-blue-400' : 'text-muted-foreground'}`}>
        {connected ? th('live') : th('off')}
      </span>
    </div>
  )
}

export function SearchIcon(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

export function BellIcon(): React.ReactElement {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 13h4M3.5 10c0-1-1-2-1-4a5.5 5.5 0 0111 0c0 2-1 3-1 4H3.5z" />
    </svg>
  )
}
