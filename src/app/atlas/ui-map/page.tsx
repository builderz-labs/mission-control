import { AtlasShell } from '@/components/atlas/primitives'

const SURFACES = [
  { name: 'The Office', purpose: 'Operator HUD — daily brief, priorities, what needs Jackson now.', owner: 'Helmy' },
  { name: 'Command Deck', purpose: 'Live status of agents, model fabric load, run throughput.', owner: 'Thinky' },
  { name: 'Org Chart', purpose: 'Visual hierarchy of named agents + reporting lines.', owner: 'Helmy' },
  { name: 'Assembly Line', purpose: 'Workflow lanes — n8n + Thinky pipelines.', owner: 'Thinky' },
  { name: 'The Vault', purpose: 'Source-of-truth registry — Supabase tables + secrets boundaries.', owner: 'Dr Strange' },
  { name: 'The Library', purpose: 'Mirror brain — Obsidian vault structure and read-only views.', owner: 'Dr Strange' },
  { name: 'The Workshop', purpose: 'Build surface — skills, MCP servers, prompts, tools.', owner: 'Skywalker' },
  { name: 'Idea Forge', purpose: 'Capture → triage → spec. Promotes ideas into Assembly Line.', owner: 'Helmy' },
  { name: 'Intelligence Room', purpose: 'Research lane — Velma\'s outputs, citations, decisions.', owner: 'Velma' },
  { name: 'Approvals', purpose: 'Gated actions awaiting Jackson sign-off.', owner: 'Seccy' },
  { name: 'Settings', purpose: 'Themes, integrations, model keys, gateway config.', owner: 'Operator' },
  { name: 'System Atlas', purpose: 'You are here. Architecture-as-product.', owner: 'All' },
]

export default function UIMap() {
  return (
    <AtlasShell
      title="10 — DarkMada UI Map"
      subtitle="Every surface in the v3 control plane and the agent that owns it. Owners are responsible for keeping the surface useful and the underlying data correct."
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card/60">
            <tr className="text-left">
              <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Surface</th>
              <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Purpose</th>
              <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Owner</th>
            </tr>
          </thead>
          <tbody>
            {SURFACES.map((s) => (
              <tr key={s.name} className="border-t border-border/50 hover:bg-card/40">
                <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.purpose}</td>
                <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-void-cyan">{s.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AtlasShell>
  )
}
