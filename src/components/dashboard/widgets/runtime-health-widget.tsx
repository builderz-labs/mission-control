'use client'

import { HealthRow, formatUptime, type DashboardData } from '../widget-primitives'

export function RuntimeHealthWidget({ data }: { data: DashboardData }) {
  const { localOsStatus, claudeHealth, codexHealth, hermesHealth, hermesRuntime, mcHealth, memPct, systemStats } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Local Runtime Health</h3></div>
      <div className="panel-body space-y-3">
        <HealthRow label="Local OS" value={localOsStatus.value} status={localOsStatus.status} />
        <HealthRow label="Claude Runtime" value={claudeHealth.value} status={claudeHealth.status} />
        <HealthRow label="Codex Runtime" value={codexHealth.value} status={codexHealth.status} />
        <HealthRow label="Hermes Runtime" value={hermesHealth.value} status={hermesHealth.status} />
        {hermesRuntime && (
          <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
            <HealthRow
              label="Hermes automation"
              value={hermesRuntime.automation.label}
              status={hermesRuntime.automation.active ? 'good' : hermesRuntime.automation.enabledJobs > 0 ? 'warn' : 'bad'}
            />
            <HealthRow
              label="HH recovery"
              value={hermesRuntime.hhRecovery.label}
              status={hermesRuntime.hhRecovery.state === 'success' ? 'good' : hermesRuntime.hhRecovery.state === 'error' ? 'bad' : hermesRuntime.hhRecovery.state === 'warning' ? 'warn' : 'bad'}
            />
            <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
              <span>{hermesRuntime.automation.enabledJobs}/{hermesRuntime.automation.totalJobs} cron jobs</span>
              <span>·</span>
              <span>{hermesRuntime.activeSessions} active sessions</span>
              <span>·</span>
              <span>{hermesRuntime.memoryEntries} memory entries</span>
            </div>
          </div>
        )}
        <HealthRow label="MC Core" value={mcHealth.value} status={mcHealth.status} />
        {memPct != null && <HealthRow label="Memory" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />}
        {systemStats?.disk && <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />}
        {systemStats?.uptime != null && <HealthRow label="Uptime" value={formatUptime(systemStats.uptime)} status="good" />}
      </div>
    </div>
  )
}
