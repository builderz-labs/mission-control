'use client'

import { useState } from 'react'
import { HealthRow, type DashboardData } from '../widget-primitives'
import { formatUptime } from '../widget-utils'

export function SystemHealthWidget({ data }: { data: DashboardData }) {
  const {
    memPct,
    diskPct,
    systemStats,
    isSystemLoading,
    localOsStatus,
    claudeHealth,
    codexHealth,
    hermesHealth,
    mcHealth,
    errorCount,
    connection,
    isLocal,
    gatewayHealthStatus,
  } = data

  const [expanded, setExpanded] = useState(false)

  if (isSystemLoading) {
    return (
      <div className="rounded-xl border border-border bg-card/80 px-4 py-2.5">
        <span className="text-2xs text-muted-foreground">Loading system health...</span>
      </div>
    )
  }

  const cpuPct = systemStats?.cpu?.usage != null
    ? Math.round(systemStats.cpu.usage)
    : null

  const uptimeStr = systemStats?.uptime != null ? formatUptime(systemStats.uptime) : null

  // Determine overall health for trend arrow
  const memTrend = memPct != null && memPct > 80 ? 'up' : memPct != null && memPct < 50 ? 'down' : null

  return (
    <div className="rounded-xl border border-border bg-card/80">
      {/* Compact bar */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-muted-foreground hover:bg-secondary/20 transition-smooth rounded-xl"
      >
        <span className="text-xs font-semibold text-foreground/80">System</span>

        {cpuPct != null && (
          <span>CPU <span className={`font-mono-tight ${cpuPct > 80 ? 'text-red-400' : cpuPct > 60 ? 'text-amber-400' : 'text-foreground/70'}`}>{cpuPct}%</span></span>
        )}

        {memPct != null && (
          <span className="inline-flex items-center gap-1">
            Mem <span className={`font-mono-tight ${memPct > 90 ? 'text-red-400' : memPct > 70 ? 'text-amber-400' : 'text-foreground/70'}`}>{memPct}%</span>
            {memTrend === 'up' && <span className="text-amber-400">▲</span>}
            {memTrend === 'down' && <span className="text-green-400">▼</span>}
          </span>
        )}

        {Number.isFinite(diskPct) && (
          <span>Disk <span className="font-mono-tight text-foreground/70">{diskPct}%</span></span>
        )}

        {uptimeStr && <span>Uptime <span className="font-mono-tight text-foreground/70">{uptimeStr}</span></span>}

        <span className="inline-flex items-center gap-1">
          MC
          <span className={`size-1.5 rounded-full ${errorCount > 0 ? 'bg-amber-500' : 'bg-green-500'}`} />
          <span className="font-mono-tight text-foreground/70">{errorCount > 0 ? `${errorCount} err` : 'OK'}</span>
        </span>

        <span className="ml-auto text-muted-foreground/40">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2.5 border-t border-border/50">
          {isLocal ? (
            <>
              <HealthRow label="Local OS" value={localOsStatus.value} status={localOsStatus.status} />
              <HealthRow label="Claude Runtime" value={claudeHealth.value} status={claudeHealth.status} />
              <HealthRow label="Codex Runtime" value={codexHealth.value} status={codexHealth.status} />
              <HealthRow label="Hermes Runtime" value={hermesHealth.value} status={hermesHealth.status} />
              <HealthRow label="MC Core" value={mcHealth.value} status={mcHealth.status} />
            </>
          ) : (
            <>
              <HealthRow label="Gateway" value={connection.isConnected ? 'Connected' : 'Disconnected'} status={gatewayHealthStatus} />
              <HealthRow label="MC Core" value={mcHealth.value} status={mcHealth.status} />
            </>
          )}
          {memPct != null && (
            <HealthRow label="Memory" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />
          )}
          {systemStats?.disk && (
            <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />
          )}
        </div>
      )}
    </div>
  )
}
