'use client'

import { DmShell, Card, Pill } from './shell'
import { MCP_SERVICES } from '@/lib/darkmada/mock'

const SKILLS = [
  { id: 'spec-writer', label: 'Spec writer', owner: 'Skywalker', status: 'live' },
  { id: 'pr-opener', label: 'PR opener', owner: 'Skywalker', status: 'live' },
  { id: 'memory-summarizer', label: 'Memory summarizer', owner: 'Dr Strange', status: 'live' },
  { id: 'briefing-composer', label: 'Briefing composer', owner: 'Helmy', status: 'live' },
  { id: 'research-synthesizer', label: 'Research synthesizer', owner: 'Velma', status: 'live' },
  { id: 'audit-diff', label: 'Audit diff', owner: 'Seccy', status: 'live' },
  { id: 'telegram-router', label: 'Telegram router', owner: 'Helmy', status: 'draft' },
  { id: 'calendar-aware-planner', label: 'Calendar-aware planner', owner: 'Thinky', status: 'draft' },
]

export function TheWorkshop() {
  return (
    <DmShell
      eyebrow="The Workshop · Build surface"
      title="Skills, MCP servers, and tools"
      subtitle="Where Skywalker forges new capabilities. Skills become MCP-exposed tools that any agent can call."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card eyebrow="Skills" title="Catalog" accent="violet">
          <div className="space-y-2">
            {SKILLS.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">owner: {s.owner}</div>
                </div>
                <Pill accent={s.status === 'live' ? 'mint' : 'amber'}>{s.status}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card eyebrow="MCP servers" title="Custom layer" accent="cyan">
          <div className="space-y-2">
            {MCP_SERVICES.map((s) => (
              <div key={s.id} className="rounded-md border border-border bg-background/60 px-3 py-2.5">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.responsibility}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DmShell>
  )
}
