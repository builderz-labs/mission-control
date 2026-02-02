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

interface StatCardProps {
  title: string
  value: string | number
  icon: string
  trend?: 'up' | 'down' | 'stable'
  subtitle?: string
  color?: 'default' | 'success' | 'warning' | 'danger'
}

function StatCard({ title, value, icon, trend, subtitle, color = 'default' }: StatCardProps) {
  const colorClasses = {
    default: 'bg-card border-border',
    success: 'bg-green-500/10 border-green-500/30',
    warning: 'bg-yellow-500/10 border-yellow-500/30',
    danger: 'bg-red-500/10 border-red-500/30'
  }

  const iconColorClasses = {
    default: 'text-primary',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400'
  }

  return (
    <div className={`p-6 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {trend && (
              <span className={`text-sm ${
                trend === 'up' ? 'text-green-400' : 
                trend === 'down' ? 'text-red-400' : 
                'text-muted-foreground'
              }`}>
                {trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→'}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`text-2xl ${iconColorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

export function StatsGrid({ stats, systemStats }: StatsGridProps) {
  const uptimeFormatted = systemStats?.uptime ? 
    formatUptime(systemStats.uptime) : 
    formatUptime(Date.now() - stats.uptime)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
      <StatCard
        title="Total Sessions"
        value={stats.totalSessions}
        icon="📊"
        trend="stable"
        color="default"
      />
      
      <StatCard
        title="Active Sessions"
        value={stats.activeSessions}
        icon="🟢"
        trend="up"
        subtitle={`${Math.round((stats.activeSessions / stats.totalSessions) * 100)}% active`}
        color="success"
      />
      
      <StatCard
        title="Messages"
        value={stats.totalMessages.toLocaleString()}
        icon="💬"
        trend="up"
        subtitle="Total processed"
        color="default"
      />
      
      <StatCard
        title="Uptime"
        value={uptimeFormatted}
        icon="⏱️"
        trend="stable"
        subtitle="System running"
        color="default"
      />
      
      <StatCard
        title="Errors"
        value={stats.errors}
        icon={stats.errors > 0 ? "⚠️" : "✅"}
        trend={stats.errors > 0 ? "up" : "stable"}
        subtitle="Past 24h"
        color={stats.errors > 0 ? "danger" : "success"}
      />
    </div>
  )
}