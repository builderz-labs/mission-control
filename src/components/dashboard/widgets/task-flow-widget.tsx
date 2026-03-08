'use client'

import { StatRow, type DashboardData } from '../widget-primitives'

export function TaskFlowWidget({ data }: { data: DashboardData }) {
  const { inboxCount, assignedCount, runningTasks, reviewCount, doneCount, backlogCount } = data

  return (
    <div className="panel">
      <div className="panel-header"><h3 className="text-sm font-semibold">Task Flow</h3></div>
      <div className="panel-body grid grid-cols-2 gap-3">
        <StatRow label="Inbox" value={inboxCount} />
        <StatRow label="Assigned" value={assignedCount} />
        <StatRow label="In Progress" value={runningTasks} />
        <StatRow label="Review" value={reviewCount} />
        <StatRow label="Done" value={doneCount} />
        <StatRow label="Backlog" value={backlogCount} alert={backlogCount > 12} />
      </div>
    </div>
  )
}
