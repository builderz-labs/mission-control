import { AtlasShell, Node, Lane } from '@/components/atlas/primitives'
import { MODELS } from '@/lib/darkmada/mock'

export default function RuntimeView() {
  return (
    <AtlasShell
      title="06 — Runtime + Model Fabric"
      subtitle="Node.js processes host the agents. The model router picks local or cloud per task — local first when latency or privacy matter, cloud when judgment or recency is required."
    >
      <div className="space-y-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-void-mint/30 bg-void-mint/[0.04] p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-mint">Local</div>
            <p className="text-sm mt-2 text-muted-foreground">Latency-sensitive, sensitive-data, batch reasoning. Hosted on the Mainframe account via Ollama.</p>
          </div>
          <div className="rounded-lg border border-void-cyan/30 bg-void-cyan/[0.04] p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-cyan">Cloud frontier</div>
            <p className="text-sm mt-2 text-muted-foreground">Judgment, multi-step planning, sensitive comms. Helmy drafts here; Velma uses for synthesis.</p>
          </div>
          <div className="rounded-lg border border-void-amber/30 bg-void-amber/[0.04] p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-void-amber">Cloud fast</div>
            <p className="text-sm mt-2 text-muted-foreground">Default agent workhorse. Cost-aware. Falls back to local when cloud is rate-limited.</p>
          </div>
        </div>

        <Lane label="Model registry" accent="violet">
          {MODELS.map((m) => (
            <Node
              key={m.id}
              title={m.label}
              subtitle={m.bestFor}
              meta={`${m.provider} · ${m.tier} · ${m.cost}`}
              accent={m.tier === 'local' ? 'mint' : m.tier === 'cloud-frontier' ? 'cyan' : 'amber'}
            />
          ))}
        </Lane>

        <div className="rounded-lg border border-border bg-card/60 p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-void-cyan">Routing rules (Thinky)</div>
          <ol className="mt-3 space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li><span className="text-foreground">If</span> the task carries sensitive data → local model only.</li>
            <li><span className="text-foreground">If</span> the task is approval-bound exec comms → Claude Opus 4.7.</li>
            <li><span className="text-foreground">If</span> the task is research synthesis → GPT-5 + Claude Sonnet for second pass.</li>
            <li><span className="text-foreground">Else</span> → Claude Sonnet 4.6 with Qwen 3.5 fallback.</li>
            <li><span className="text-foreground">Always</span> log the chosen model + reason into the run record.</li>
          </ol>
        </div>
      </div>
    </AtlasShell>
  )
}
