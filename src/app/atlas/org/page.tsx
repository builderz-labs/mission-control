import { AtlasShell, Node } from '@/components/atlas/primitives'
import { AGENTS } from '@/lib/darkmada/mock'

export default function OrgChart() {
  const helmy = AGENTS.find((a) => a.id === 'helmy')!
  const thinky = AGENTS.find((a) => a.id === 'thinky')!
  const seccy = AGENTS.find((a) => a.id === 'seccy')!
  const reportsToThinky = AGENTS.filter((a) => a.reportsTo === 'thinky')

  return (
    <AtlasShell
      title="04 — Agent Org Chart"
      subtitle="Helmy is the only agent with a direct line to Jackson. Thinky owns execution. Seccy is a peer reporting to Helmy on the security lane."
    >
      <div className="space-y-8">
        <div className="flex justify-center">
          <div className="rounded-xl border border-void-cyan/40 bg-void-cyan/[0.04] px-6 py-3 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-void-cyan">Operator</div>
            <div className="text-lg font-semibold mt-1">Jackson</div>
            <div className="text-xs text-muted-foreground">Founder · Approver</div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="h-8 w-px bg-gradient-to-b from-void-cyan/40 to-transparent" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 max-w-3xl mx-auto">
          <Node title={helmy.name} subtitle={helmy.title} meta={helmy.mission} accent={helmy.accent} emphasis />
          <Node title={seccy.name} subtitle={seccy.title} meta={seccy.mission} accent={seccy.accent} />
        </div>

        <div className="flex justify-center">
          <div className="h-6 w-px bg-gradient-to-b from-void-mint/40 to-transparent" />
        </div>

        <div className="flex justify-center">
          <div className="rounded-xl border border-void-mint/40 bg-void-mint/[0.04] px-6 py-3 text-center max-w-md">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-void-mint">Orchestrator</div>
            <div className="text-lg font-semibold mt-1">{thinky.name}</div>
            <div className="text-xs text-muted-foreground mt-1">{thinky.mission}</div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="h-6 w-px bg-gradient-to-b from-void-mint/40 to-transparent" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {reportsToThinky.map((a) => (
            <Node key={a.id} title={a.name} subtitle={a.title} meta={a.mission} accent={a.accent} />
          ))}
        </div>
      </div>
    </AtlasShell>
  )
}
