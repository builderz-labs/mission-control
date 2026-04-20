import { AtlasShell, Node, Lane, Bus } from '@/components/atlas/primitives'
import { MCP_SERVICES } from '@/lib/darkmada/mock'

export default function MCPArchitecture() {
  return (
    <AtlasShell
      title="05 — MCP Architecture"
      subtitle="The custom MCP layer is the only sanctioned channel between agents and the spine. Every tool call, memory read, and event flows through it — and is logged."
    >
      <div className="space-y-6">
        <Lane label="Consumers (agents)" accent="cyan">
          <Node title="Helmy" subtitle="Strategy + comms" accent="cyan" />
          <Node title="Thinky" subtitle="Orchestration" accent="mint" />
          <Node title="Skywalker" subtitle="Engineering" accent="violet" />
          <Node title="Velma" subtitle="Research" accent="amber" />
          <Node title="Dr Strange" subtitle="Memory" accent="violet" />
          <Node title="Seccy" subtitle="Security" accent="crimson" />
        </Lane>

        <Bus label="MCP Core Gateway · auth · tenant · rate-limit" accent="violet" />

        <div className="grid gap-3 md:grid-cols-2">
          {MCP_SERVICES.filter((s) => s.id !== 'mcp-gateway').map((s) => (
            <div key={s.id} className="rounded-lg border border-void-violet/20 bg-void-violet/[0.03] p-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="font-medium text-foreground">{s.label}</div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-void-violet">{s.source}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.responsibility}</p>
              <div className="mt-3 flex gap-1.5 flex-wrap">
                {s.consumers.map((c) => (
                  <span key={c} className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-background/60 border border-border text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Bus label="Spine writes / reads" accent="cyan" />

        <Lane label="Backed by" accent="cyan">
          <Node title="Supabase" subtitle="Truth source" accent="cyan" />
          <Node title="pgvector" subtitle="Retrieval" accent="cyan" />
          <Node title="Storage" subtitle="Artifacts" accent="cyan" />
        </Lane>
      </div>
    </AtlasShell>
  )
}
