'use client'

import { HealthRow, type DashboardData } from '../widget-primitives'

export function GatewayHealthWidget({ data }: { data: DashboardData }) {
  const { connection, sessions, errorCount, backlogCount, memPct, systemStats, gatewayHealthStatus } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Gateway Health + Golden Signals</h3></div>
      <div className="panel-body space-y-3">
        <HealthRow label="Gateway" value={connection.isConnected ? 'Connected' : 'Disconnected'} status={gatewayHealthStatus} />
        <HealthRow label="Traffic (sessions)" value={`${sessions.length}`} status={sessions.length > 0 ? 'good' : 'warn'} />
        <HealthRow label="Errors (24h)" value={`${errorCount}`} status={errorCount > 0 ? 'warn' : 'good'} />
        <HealthRow label="Saturation (queue)" value={`${backlogCount}`} status={backlogCount > 16 ? 'bad' : backlogCount > 8 ? 'warn' : 'good'} />
        {memPct != null && <HealthRow label="Memory" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />}
        {systemStats?.disk && <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />}
      </div>
    </div>
  )
}
