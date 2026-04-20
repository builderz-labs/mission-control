import { AtlasShell } from '@/components/atlas/primitives'

const STEPS = [
  { n: 1, owner: 'Jackson', label: 'Intent', detail: 'Telegram or DarkMada: "Draft Q3 board update."', accent: 'cyan' },
  { n: 2, owner: 'Helmy', label: 'Frame', detail: 'Decides scope, audience, tone. Writes a one-paragraph brief.', accent: 'cyan' },
  { n: 3, owner: 'Thinky', label: 'Decompose', detail: 'Splits into research → draft → review. Picks model + agent per step.', accent: 'mint' },
  { n: 4, owner: 'Velma', label: 'Research', detail: 'Pulls metrics, recent wins, blockers from memory + retrieval.', accent: 'amber' },
  { n: 5, owner: 'Dr Strange', label: 'Context', detail: 'Loads prior board updates + tone exemplars via Memory API.', accent: 'violet' },
  { n: 6, owner: 'Helmy', label: 'Draft', detail: 'Composes the update against Velma\'s pack + Strange\'s context.', accent: 'cyan' },
  { n: 7, owner: 'Seccy', label: 'Gate', detail: 'Checks for sensitive data leaks. Stages an approval card.', accent: 'crimson' },
  { n: 8, owner: 'Jackson', label: 'Approve', detail: 'One-tap from iPhone or the Approvals panel.', accent: 'cyan' },
  { n: 9, owner: 'n8n', label: 'Deliver', detail: 'Sends via configured channel (email / Telegram / file).', accent: 'amber' },
  { n: 10, owner: 'Audit', label: 'Persist', detail: 'Run, prompts, models, costs, outputs written to audit_logs.', accent: 'mint' },
]

const SHADOW: Record<string, string> = {
  cyan: 'shadow-[0_0_0_1px_hsl(var(--void-cyan)/0.25)]',
  mint: 'shadow-[0_0_0_1px_hsl(var(--void-mint)/0.25)]',
  amber: 'shadow-[0_0_0_1px_hsl(var(--void-amber)/0.25)]',
  violet: 'shadow-[0_0_0_1px_hsl(var(--void-violet)/0.25)]',
  crimson: 'shadow-[0_0_0_1px_hsl(var(--void-crimson)/0.25)]',
}
const TEXT: Record<string, string> = {
  cyan: 'text-void-cyan',
  mint: 'text-void-mint',
  amber: 'text-void-amber',
  violet: 'text-void-violet',
  crimson: 'text-void-crimson',
}

export default function ExecutionFlow() {
  return (
    <AtlasShell
      title="02 — Execution Flow"
      subtitle="The canonical path from intent to delivery. Every run is observable, every irreversible action is gated, and every artifact lands in the audit trail."
    >
      <ol className="relative space-y-3">
        <div className="absolute left-[34px] top-2 bottom-2 w-px bg-gradient-to-b from-void-cyan/30 via-void-violet/30 to-void-amber/20" />
        {STEPS.map((s) => (
          <li key={s.n} className="relative flex gap-4 items-start pl-0">
            <div className={`relative z-10 shrink-0 h-[68px] w-[68px] rounded-lg bg-card border border-border flex flex-col items-center justify-center ${SHADOW[s.accent]}`}>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">step</span>
              <span className={`text-2xl font-semibold ${TEXT[s.accent]} leading-none`}>{s.n.toString().padStart(2, '0')}</span>
            </div>
            <div className="flex-1 rounded-lg border border-border bg-card/60 px-4 py-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${TEXT[s.accent]}`}>{s.owner}</span>
                <span className="text-base font-medium text-foreground">{s.label}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </AtlasShell>
  )
}
