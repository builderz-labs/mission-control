'use client'

import type { UnifiedStatusEvent } from '@/types/mission-control'

export function EventStreamPanel({ events }: { events: UnifiedStatusEvent[] }) {
  return (
    <section className="panel h-full">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Live Activity Feed</h2>
        <span className="text-2xs font-medium text-muted-foreground">{events.length} events</span>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No mission activity yet.
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {events.map((event) => (
              <div key={event.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground">
                      <span className="font-medium">{event.agentName || 'System'}</span> {event.summary}
                    </p>
                    {event.thinkingSummary && (
                      <p className="mt-1 text-2xs text-muted-foreground">
                        Thinking: {event.thinkingSummary}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                      <span>{formatClock(event.ts)}</span>
                      <span>{event.kind}</span>
                      {event.stage && <span>{event.stage}</span>}
                      {event.toolName && <span>tool {event.toolName}</span>}
                      {event.toolArgsPreview && <span>args {event.toolArgsPreview}</span>}
                      {event.toolResult && <span>result {event.toolResult}</span>}
                      {event.latency != null && <span>{event.latency} ms</span>}
                      {event.model && <span>{event.model}</span>}
                      {event.tokenUsage != null && <span>{event.tokenUsage} tok</span>}
                      {event.taskTitle && <span>{event.taskTitle}</span>}
                    </div>
                  </div>
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-2xs ${
                    event.severity === 'error'
                      ? 'bg-red-500/10 text-red-400'
                      : event.severity === 'warn'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-secondary text-muted-foreground'
                  }`}>
                    {event.severity || 'info'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function formatClock(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
