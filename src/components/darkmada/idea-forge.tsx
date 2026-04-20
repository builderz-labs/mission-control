'use client'

import { DmShell, Card, Pill } from './shell'
import { ForgeIcon } from './icons'

const COLUMNS = [
  {
    id: 'capture',
    label: 'Capture',
    accent: 'cyan' as const,
    items: [
      { title: 'Voice-driven approval flow on iPhone', source: 'Jackson · voice memo' },
      { title: 'Auto-generate weekly review from audit log', source: 'Helmy · brief' },
      { title: 'Per-agent budget alerts in Telegram', source: 'Seccy · system' },
    ],
  },
  {
    id: 'triage',
    label: 'Triage',
    accent: 'violet' as const,
    items: [
      { title: 'Migrate task store to Supabase schema', source: 'Skywalker · spec started' },
      { title: 'Velma weekly intel digest format v2', source: 'Velma · proposal' },
    ],
  },
  {
    id: 'spec',
    label: 'Spec',
    accent: 'amber' as const,
    items: [
      { title: 'Multi-tenant MCP gateway design', source: 'Skywalker · WIP' },
    ],
  },
  {
    id: 'shipped',
    label: 'Shipped',
    accent: 'mint' as const,
    items: [
      { title: 'DarkMada atlas + control plane', source: 'today' },
      { title: 'Approval push to Telegram', source: 'last week' },
    ],
  },
]

export function IdeaForge() {
  return (
    <DmShell
      icon={<ForgeIcon size={22} />}
      eyebrow="Idea Forge · Capture → Ship"
      title="Where ideas become work"
      subtitle="Captured ideas land here, get triaged by Helmy, become specs by Skywalker, and feed the Assembly Line."
    >
      <div className="grid gap-4 md:grid-cols-4">
        {COLUMNS.map((col) => (
          <Card key={col.id} eyebrow={`${col.items.length} items`} title={col.label} accent={col.accent}>
            <div className="space-y-2">
              {col.items.map((it, i) => (
                <div key={i} className="rounded-md border border-border bg-background/60 px-3 py-2.5">
                  <div className="text-sm leading-snug">{it.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{it.source}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card eyebrow="Promotion rule" title="What moves an idea forward" accent="cyan">
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Capture: any source — Jackson, agent, Telegram, system signal.</li>
          <li>Triage: Helmy decides scope, owner, and rough effort.</li>
          <li>Spec: Skywalker writes a one-page spec (problem, approach, success).</li>
          <li>Promote: an Assembly Line lane is created and wired to Thinky.</li>
        </ol>
      </Card>
    </DmShell>
  )
}
