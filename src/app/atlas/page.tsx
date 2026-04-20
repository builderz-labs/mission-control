import Link from 'next/link'

const VIEWS = [
  { href: '/atlas/system', code: '01', title: 'Full system overview', desc: 'Every layer at a glance — operator, control plane, runtime, data, compute.' },
  { href: '/atlas/execution', code: '02', title: 'Execution flow', desc: 'How an intent travels from Jackson → Helmy → Thinky → an executing agent → audit.' },
  { href: '/atlas/memory', code: '03', title: 'Memory + data flow', desc: 'Supabase truth spine, pgvector retrieval, and Obsidian mirror loops.' },
  { href: '/atlas/org', code: '04', title: 'Agent org chart', desc: 'The named roster — Helmy, Thinky, Skywalker, Velma, Dr Strange, Seccy.' },
  { href: '/atlas/mcp', code: '05', title: 'MCP architecture', desc: 'The custom MCP server layer that brokers context, tools, and state.' },
  { href: '/atlas/runtime', code: '06', title: 'Runtime + model fabric', desc: 'Node.js processes + the Ollama / OpenAI / Anthropic routing strategy.' },
  { href: '/atlas/compute', code: '07', title: 'Compute + accounts', desc: 'MBP three-account split, future Mac mini, modular expansion lanes.' },
  { href: '/atlas/network', code: '08', title: 'Network + security', desc: 'VLANs, WireGuard, optional Starlink, founder vs server lanes.' },
  { href: '/atlas/scale', code: '09', title: 'Future scale path', desc: 'Modular expansion — what comes online next and in what order.' },
  { href: '/atlas/ui-map', code: '10', title: 'DarkMada UI map', desc: 'Every page surface in v3 and what it owns.' },
]

export default function AtlasIndex() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-void-cyan">DarkMada — System Atlas</div>
        <h1 className="text-3xl font-semibold tracking-tight">Architecture, mapped.</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          The System Atlas is the visual companion to the DarkMada control plane. Each view below is a
          first-class, hand-built diagram of a single concern. Use it as a living architecture reference, an
          onboarding surface for new agents (OpenClaw, Helmy), and the canonical place to reason about changes
          before they ship.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {VIEWS.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            className="group rounded-xl border border-border bg-card/60 p-5 hover:border-void-cyan/50 hover:bg-card transition"
          >
            <div className="flex items-start gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground group-hover:text-void-cyan mt-1">
                {v.code}
              </span>
              <div className="flex-1">
                <div className="font-medium text-foreground group-hover:text-void-cyan transition">{v.title}</div>
                <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{v.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <section className="rounded-xl border border-void-cyan/20 bg-void-cyan/[0.03] p-6 space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-void-cyan">For agents (OpenClaw, Helmy)</div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The atlas is mirrored in markdown under <code className="text-void-cyan">docs/architecture</code> and
          <code className="text-void-cyan"> docs/integration</code>. Treat the markdown as canonical for ingest;
          treat this UI as canonical for human review. The two are kept in sync — never one without the other.
        </p>
      </section>
    </div>
  )
}
