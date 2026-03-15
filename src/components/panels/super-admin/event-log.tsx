import type { ProvisionEvent } from './types'

interface EventLogProps {
  selectedJobId: number | null
  selectedJobEvents: ProvisionEvent[]
}

export function EventLog({ selectedJobId, selectedJobEvents }: EventLogProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground px-1">
        {selectedJobId ? `Showing events for job #${selectedJobId}` : 'Select a job to inspect provisioning event log.'}
      </div>
      <div className="max-h-[420px] overflow-y-auto space-y-2">
        {selectedJobId && selectedJobEvents.length === 0 && (
          <div className="text-xs text-muted-foreground">No events for this job yet.</div>
        )}
        {selectedJobEvents.map((ev) => (
          <div key={ev.id} className="rounded border border-border/60 bg-secondary/20 px-3 py-2">
            <div className="text-[11px] text-muted-foreground mb-0.5">
              {new Date(ev.created_at * 1000).toLocaleString()} · {ev.level}{ev.step_key ? ` · ${ev.step_key}` : ''}
            </div>
            <div className="text-sm text-foreground">{ev.message}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
