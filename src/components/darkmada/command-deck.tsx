'use client'

import { DmShell, Card, Stat, Pill } from './shell'
import { AGENTS, MODELS } from '@/lib/darkmada/mock'

export function CommandDeck() {
  return (
    <DmShell
      eyebrow="Command Deck · Live"
      title="Fleet status"
      subtitle="Real-time view of every named agent, the model fabric they're drawing on, and the throughput of the system."
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Agents online" value={`${AGENTS.filter((a) => a.status === 'online').length}/${AGENTS.length}`} accent="mint" />
        <Stat label="Active runs" value="7" hint="3 awaiting tools" accent="cyan" />
        <Stat label="P95 latency" value="2.4s" hint="local · cloud blended" accent="violet" />
        <Stat label="Spend (today)" value="$3.42" hint="32% of budget" accent="amber" />
      </div>

      <Card eyebrow="Agent fleet" title="Roster" accent="cyan">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-background/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{a.title}</div>
                </div>
                <Pill accent={a.status === 'online' ? 'mint' : a.status === 'idle' ? 'amber' : 'crimson'}>{a.status}</Pill>
              </div>
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{a.mission}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill accent={a.accent}>{a.primaryModel}</Pill>
                <Pill accent="muted">↓ {a.fallbackModel}</Pill>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card eyebrow="Model fabric · load" title="Now serving" accent="violet">
        <div className="space-y-2">
          {MODELS.map((m) => {
            const load = Math.floor(Math.abs(Math.sin(m.id.length * 7.3)) * 80) + 5
            return (
              <div key={m.id} className="flex items-center gap-4">
                <div className="w-44 shrink-0">
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{m.provider} · {m.tier}</div>
                </div>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${m.tier === 'local' ? 'bg-void-mint' : m.tier === 'cloud-frontier' ? 'bg-void-cyan' : 'bg-void-amber'}`}
                    style={{ width: `${load}%` }}
                  />
                </div>
                <div className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">{load}%</div>
              </div>
            )
          })}
        </div>
      </Card>
    </DmShell>
  )
}
