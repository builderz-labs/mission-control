import { AtlasShell } from '@/components/atlas/primitives'

const PHASES = [
  {
    code: 'now',
    title: 'Phase 0 — Today',
    accent: 'cyan',
    items: [
      'MacBook Pro 48GB hosts everything (3 accounts).',
      'DarkMada + Atlas live in this repo.',
      'Local models via Ollama on Mainframe account.',
      'Telegram is the executive ingress.',
    ],
  },
  {
    code: 'next',
    title: 'Phase 1 — Next',
    accent: 'mint',
    items: [
      'Mac mini comes online as always-on host (SpiderMan + Mainframe migrate over).',
      'Real Supabase project provisioned; current SQLite store mirrors into it.',
      'MCP Core Gateway implemented as a Node service with auth tokens per agent.',
      'Obsidian mirror writer ships behind a feature flag.',
    ],
  },
  {
    code: 'expand',
    title: 'Phase 2 — Expand',
    accent: 'violet',
    items: [
      'Edge VPS pool behind WireGuard receives webhooks (n8n workers).',
      'Work iPhone joins the founder lane via VPN.',
      'Secondary GPU node added to the Mainframe account for larger local models.',
      'Approvals get push-notification escalation paths.',
    ],
  },
  {
    code: 'scale',
    title: 'Phase 3 — Scale',
    accent: 'amber',
    items: [
      'Multi-tenant MCP gateway — Helmy can spawn project-scoped subordinate agents.',
      'Hot-standby Mac mini as a peer; Postgres in primary/replica.',
      'Public-facing presence via reverse proxy + per-tool rate limits.',
      'Optional Starlink secondary uplink for resilience.',
    ],
  },
]

const BORDER: Record<string, string> = {
  cyan: 'border-void-cyan/30',
  mint: 'border-void-mint/30',
  violet: 'border-void-violet/30',
  amber: 'border-void-amber/30',
}
const TEXT: Record<string, string> = {
  cyan: 'text-void-cyan',
  mint: 'text-void-mint',
  violet: 'text-void-violet',
  amber: 'text-void-amber',
}

export default function ScaleView() {
  return (
    <AtlasShell
      title="09 — Future Modular Scale"
      subtitle="The system is designed to grow one lane at a time. Nothing in Phase 0 needs to be rewritten to reach Phase 3 — only the runtime topology changes."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {PHASES.map((p) => (
          <div key={p.code} className={`rounded-xl border p-5 bg-card/60 ${BORDER[p.accent]}`}>
            <div className={`font-mono text-[10px] uppercase tracking-[0.2em] ${TEXT[p.accent]}`}>{p.code}</div>
            <div className="text-base font-semibold mt-1 text-foreground">{p.title}</div>
            <ul className="mt-4 space-y-2">
              {p.items.map((i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className={`${TEXT[p.accent]} mt-0.5`}>▸</span>
                  <span className="leading-relaxed">{i}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </AtlasShell>
  )
}
