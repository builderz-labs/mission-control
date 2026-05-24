'use client'

import { formatUptime } from '@/lib/utils'

interface Stats {
  totalSessions: number
  activeSessions: number
  totalMessages: number
  uptime: number
  errors: number
}

interface StatsGridProps {
  stats: Stats
  systemStats?: any
}

// SVG stat icons (16x16, stroke-based)
function MonitorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <rect x="1" y="2" width="14" height="9" rx="1.5" />
      <path d="M5 14h6M8 11v3" />
    </svg>
  )
}

function PulseCircleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 2V4a1 1 0 011-1z" />
      <path d="M5 7h6M5 9.5h3" />
    </svg>
  )
}

function UptimeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4v4l2.5 2.5" />
    </svg>
  )
}

function WarningTriangleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <path d="M8 1.5L1 14h14L8 1.5z" />
      <path d="M8 6v4M8 12h.01" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8l2 2 3.5-4" />
    </svg>
  )
}

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'stable'
  subtitle?: string
  color?: 'default' | 'success' | 'warning' | 'danger'
}

function StatCard({ title, value, icon, trend, subtitle, color = 'default' }: StatCardProps) {
  const colorClasses = {
    default: 'void-panel',
    success: 'void-panel border-void-mint/30',
    warning: 'void-panel border-void-amber/30',
    danger: 'void-panel border-void-crimson/30'
  }

  const iconColorClasses = {
    default: 'text-void-cyan',
    success: 'text-void-mint',
    warning: 'text-void-amber',
    danger: 'text-void-crimson'
  }

  const glowClasses = {
    default: '',
    success: 'badge-glow-success',
    warning: 'badge-glow-warning',
    danger: 'badge-glow-error'
  }

  return (
    <div className={`p-6 ${colorClasses[color]} ${glowClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="flex items-baseline gap-x-2">
            <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
            {trend && (
              <span className={`text-sm ${
                trend === 'up' ? 'text-void-mint' :
                trend === 'down' ? 'text-void-crimson' :
                'text-muted-foreground'
              }`}>
                {trend === 'up' ? '\u2197' : trend === 'down' ? '\u2198' : '\u2192'}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`${iconColorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function StatsGrid({ stats, systemStats }: StatsGridProps) {
  const uptimeFormatted = systemStats?.uptime ? 
    formatUptime(systemStats.uptime) : 
    formatUptime(Date.now() - stats.uptime)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
      <StatCard
        title="Total Sessions"
        value={stats.totalSessions}
        icon={<MonitorIcon />}
        trend="stable"
        color="default"
      />

      <StatCard
        title="Active Sessions"
        value={stats.activeSessions}
        icon={<PulseCircleIcon />}
        trend="up"
        subtitle={`${stats.totalSessions > 0 ? Math.round((stats.activeSessions / stats.totalSessions) * 100) : 0}% active`}
        color="success"
      />

      <StatCard
        title="Messages"
        value={stats.totalMessages.toLocaleString()}
        icon={<ChatIcon />}
        trend="up"
        subtitle="Total processed"
        color="default"
      />

      <StatCard
        title="Uptime"
        value={uptimeFormatted}
        icon={<UptimeIcon />}
        trend="stable"
        subtitle="System running"
        color="default"
      />

      <StatCard
        title="Errors"
        value={stats.errors}
        icon={stats.errors > 0 ? <WarningTriangleIcon /> : <CheckCircleIcon />}
        trend={stats.errors > 0 ? "up" : "stable"}
        subtitle="Past 24h"
        color={stats.errors > 0 ? "danger" : "success"}
      />
    </div>
  )
}