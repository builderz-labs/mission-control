'use client'

import { StatRow, type DashboardData } from '../widget-primitives'

export function SecurityAuditWidget({ data }: { data: DashboardData }) {
  const { dbStats } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Security + Audit</h3></div>
      <div className="panel-body space-y-3">
        <StatRow label="Audit events (24h)" value={dbStats?.audit.day ?? 0} />
        <StatRow label="Audit events (7d)" value={dbStats?.audit.week ?? 0} />
        <StatRow label="Login failures (24h)" value={dbStats?.audit.loginFailures ?? 0} alert={dbStats ? dbStats.audit.loginFailures > 0 : false} />
        <StatRow label="Unread notifications" value={dbStats?.notifications.unread ?? 0} alert={(dbStats?.notifications.unread ?? 0) > 0} />
      </div>
    </div>
  )
}
