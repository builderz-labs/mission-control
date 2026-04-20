import { AtlasShell, Node, Lane } from '@/components/atlas/primitives'
import { COMPUTE_NODES, MACHINE_ACCOUNTS } from '@/lib/darkmada/mock'

export default function ComputeView() {
  return (
    <AtlasShell
      title="07 — Compute, Machines, Accounts"
      subtitle="The MacBook Pro hosts three macOS user accounts that isolate concerns. The Mac mini comes online next as the always-on host."
    >
      <div className="space-y-8">
        <Lane label="MacBook Pro 48GB — three accounts" accent="cyan">
          {MACHINE_ACCOUNTS.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card/60 p-4">
              <div className="text-sm font-medium text-foreground">{a.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{a.purpose}</div>
              <ul className="mt-3 space-y-1">
                {a.responsibilities.map((r) => (
                  <li key={r} className="text-xs text-muted-foreground flex gap-2">
                    <span className="text-void-cyan">›</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Lane>

        <Lane label="Compute fabric — live + planned" accent="violet">
          {COMPUTE_NODES.map((n) => (
            <Node
              key={n.id}
              title={n.label}
              subtitle={n.notes}
              meta={`${n.kind} · ${n.status}`}
              accent={n.status === 'live' ? 'cyan' : 'muted'}
            />
          ))}
        </Lane>

        <div className="rounded-lg border border-void-amber/20 bg-void-amber/[0.04] p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-void-amber">Account boundary rule</div>
          <p className="text-sm mt-2 text-muted-foreground leading-relaxed">
            <span className="text-foreground">Jackson</span> never runs agent processes. <span className="text-foreground">SpiderMan</span> never holds
            secrets. <span className="text-foreground">Mainframe</span> never speaks to the public internet directly. Cross-account calls go through
            the MCP gateway over loopback.
          </p>
        </div>
      </div>
    </AtlasShell>
  )
}
