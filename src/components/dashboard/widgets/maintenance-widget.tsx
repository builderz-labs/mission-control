'use client'

import { StatRow, formatBytes, type DashboardData } from '../widget-primitives'

export function MaintenanceWidget({ data }: { data: DashboardData }) {
  const { dbStats } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Maintenance + Backup</h3></div>
      <div className="panel-body space-y-3">
        {dbStats?.backup ? (
          <>
            <StatRow label="Latest backup" value={dbStats.backup.age_hours < 1 ? '<1h ago' : `${dbStats.backup.age_hours}h ago`} alert={dbStats.backup.age_hours > 24} />
            <StatRow label="Backup size" value={formatBytes(dbStats.backup.size)} />
          </>
        ) : (
          <StatRow label="Latest backup" value="None" alert />
        )}
        <StatRow label="Active pipelines" value={dbStats?.pipelines.active ?? 0} />
        <StatRow label="Pipeline runs (24h)" value={dbStats?.pipelines.recentDay ?? 0} />
      </div>
    </div>
  )
}
