'use client'

import { DmShell, Card, Pill } from './shell'
import { ASSEMBLY_LANES } from '@/lib/darkmada/mock'

export function AssemblyLine() {
  return (
    <DmShell
      eyebrow="Assembly Line · Workflows"
      title="Lanes of work"
      subtitle="Every recurring or event-driven flow the system runs. Owned by an agent, triggered by a schedule, webhook, or human action."
    >
      <div className="space-y-4">
        {ASSEMBLY_LANES.map((lane) => (
          <Card key={lane.id} eyebrow={lane.trigger} title={lane.label} accent="mint">
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <Pill accent={lane.status === 'live' ? 'mint' : lane.status === 'paused' ? 'amber' : 'muted'}>{lane.status}</Pill>
              <Pill accent="muted">owner: {lane.owner}</Pill>
            </div>
            <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
              {lane.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 shrink-0">
                  <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs min-w-[140px]">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-void-mint">step {i + 1}</div>
                    <div className="text-foreground mt-0.5 leading-snug">{step}</div>
                  </div>
                  {i < lane.steps.length - 1 && <span className="text-void-mint/60">→</span>}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </DmShell>
  )
}
