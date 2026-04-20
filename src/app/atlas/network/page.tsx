import { AtlasShell, Node, Lane } from '@/components/atlas/primitives'
import { NETWORK_SEGMENTS } from '@/lib/darkmada/mock'

export default function NetworkView() {
  return (
    <AtlasShell
      title="08 — Network + Security Topology"
      subtitle="A VLAN-capable gateway segments the founder lane from the server lane. WireGuard exposes only what edge services need; Starlink is a redundant uplink."
    >
      <div className="space-y-8">
        <div className="grid gap-3 md:grid-cols-2">
          {NETWORK_SEGMENTS.map((s) => (
            <div
              key={s.id}
              className={`rounded-lg border p-4 bg-card/60 ${
                s.trust === 'founder' ? 'border-void-cyan/30' :
                s.trust === 'server' ? 'border-void-mint/30' :
                s.trust === 'edge' ? 'border-void-amber/30' :
                'border-void-crimson/30'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium text-foreground">{s.label}</div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{s.cidr}</span>
              </div>
              <div className={`font-mono text-[10px] uppercase tracking-wider mt-1 ${
                s.trust === 'founder' ? 'text-void-cyan' :
                s.trust === 'server' ? 'text-void-mint' :
                s.trust === 'edge' ? 'text-void-amber' :
                'text-void-crimson'
              }`}>
                trust: {s.trust}
              </div>
              <ul className="mt-3 space-y-1">
                {s.members.map((m) => (
                  <li key={m} className="text-xs text-muted-foreground">› {m}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Lane label="Edge defenses" accent="crimson">
          <Node title="Firewall (router)" subtitle="Default-deny inbound. Per-VLAN ACLs." accent="crimson" />
          <Node title="WireGuard" subtitle="Mesh between MBP, Mac mini, edge VPS." accent="crimson" />
          <Node title="Starlink (optional)" subtitle="Redundant uplink — failover only." accent="muted" />
          <Node title="Approval gates" subtitle="Seccy holds the signing key for irreversible ops." accent="crimson" />
          <Node title="Audit log" subtitle="Append-only, off-host backup nightly." accent="crimson" />
          <Node title="Secret store" subtitle="Jackson account only; brokered via Tool Access MCP." accent="crimson" />
        </Lane>
      </div>
    </AtlasShell>
  )
}
