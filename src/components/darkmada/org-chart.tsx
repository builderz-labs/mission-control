'use client'

import { DmShell, Card, Pill } from './shell'
import { AGENTS } from '@/lib/darkmada/mock'

export function DmOrgChart() {
  const helmy = AGENTS.find((a) => a.id === 'helmy')!
  const seccy = AGENTS.find((a) => a.id === 'seccy')!
  const thinky = AGENTS.find((a) => a.id === 'thinky')!
  const reports = AGENTS.filter((a) => a.reportsTo === 'thinky')

  return (
    <DmShell
      eyebrow="Org Chart · Hierarchy"
      title="Who reports to whom"
      subtitle="Helmy is the only agent with a line to Jackson. Thinky owns execution. Seccy reports to Helmy on the security lane."
    >
      <div className="space-y-8">
        <div className="flex justify-center">
          <div className="rounded-xl border border-void-cyan/40 bg-void-cyan/[0.04] px-8 py-4 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-void-cyan">Operator</div>
            <div className="text-xl font-semibold mt-1">Jackson</div>
            <div className="text-xs text-muted-foreground mt-0.5">Founder · Approver · Final call</div>
          </div>
        </div>

        <div className="flex justify-center"><div className="h-8 w-px bg-void-cyan/30" /></div>

        <div className="grid gap-4 md:grid-cols-2 max-w-4xl mx-auto">
          {[helmy, seccy].map((a) => (
            <Card key={a.id} eyebrow={a.role} title={`${a.name} — ${a.title}`} accent={a.accent}>
              <p className="text-sm text-muted-foreground leading-relaxed">{a.mission}</p>
              <div className="mt-3 flex gap-1.5 flex-wrap">
                {a.surfaces.map((s) => <Pill key={s} accent="muted">{s}</Pill>)}
              </div>
            </Card>
          ))}
        </div>

        <div className="flex justify-center"><div className="h-8 w-px bg-void-mint/30" /></div>

        <div className="flex justify-center">
          <div className="max-w-xl w-full">
            <Card eyebrow="orchestrator" title={`${thinky.name} — ${thinky.title}`} accent="mint">
              <p className="text-sm text-muted-foreground leading-relaxed">{thinky.mission}</p>
            </Card>
          </div>
        </div>

        <div className="flex justify-center"><div className="h-8 w-px bg-void-mint/30" /></div>

        <div className="grid gap-4 md:grid-cols-3">
          {reports.map((a) => (
            <Card key={a.id} eyebrow={a.role} title={`${a.name} — ${a.title}`} accent={a.accent}>
              <p className="text-sm text-muted-foreground leading-relaxed">{a.mission}</p>
              <div className="mt-3 flex gap-1.5 flex-wrap">
                <Pill accent={a.accent}>{a.primaryModel}</Pill>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </DmShell>
  )
}
