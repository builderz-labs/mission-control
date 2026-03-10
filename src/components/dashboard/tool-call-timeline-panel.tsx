'use client'

import type { MissionControlToolTimelineEntry } from '@/types/mission-control'

export function ToolCallTimelinePanel({ entries }: { entries: MissionControlToolTimelineEntry[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Tool Call Timeline</h2>
        <span className="text-2xs font-medium text-muted-foreground">{entries.length} entries</span>
      </div>

      <div className="max-h-[22rem] overflow-y-auto divide-y divide-border/40">
        {entries.map((entry) => (
          <div key={entry.id} className="px-4 py-3">
            <p className="text-xs text-foreground">
              <span className="font-medium">{formatClock(entry.ts)}</span> {entry.agentName} → {entry.toolName}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
              {entry.target && <span>target {entry.target}</span>}
              {entry.result && <span>result {entry.result}</span>}
              {entry.latency != null && <span>{entry.latency} ms</span>}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No tool activity available.
          </div>
        )}
      </div>
    </section>
  )
}

function formatClock(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
