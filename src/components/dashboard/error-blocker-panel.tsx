'use client'

import type { MissionControlBlockedWorkflow } from '@/types/mission-control'

export function ErrorBlockerPanel({ blocked }: { blocked: MissionControlBlockedWorkflow[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Blocked Workflows</h2>
        <span className="text-2xs font-medium text-muted-foreground">{blocked.length} open</span>
      </div>

      <div className="max-h-[22rem] overflow-y-auto divide-y divide-border/40">
        {blocked.map((item) => (
          <div key={item.id} className="px-4 py-3">
            <p className="text-xs font-medium text-foreground">{item.agentName}</p>
            <p className="mt-1 text-xs text-red-300">{item.reason}</p>
            <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
              {item.taskTitle && <span>{item.taskTitle}</span>}
              {item.stage && <span>{item.stage}</span>}
            </div>
          </div>
        ))}
        {blocked.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No blocked workflows detected.
          </div>
        )}
      </div>
    </section>
  )
}
