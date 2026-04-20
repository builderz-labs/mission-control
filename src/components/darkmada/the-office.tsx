'use client'

import Link from 'next/link'
import { DmShell, Card, Stat, Pill } from './shell'
import { TODAY_BRIEFING, AGENTS } from '@/lib/darkmada/mock'

export function TheOffice() {
  const helmy = AGENTS.find((a) => a.id === 'helmy')!
  return (
    <DmShell
      eyebrow="The Office · Operator HUD"
      title="Good morning, Jackson."
      subtitle="Today's brief from Helmy. Approvals, priorities, and what the system did overnight."
      actions={
        <Link href="/atlas" className="rounded-lg border border-void-cyan/30 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-void-cyan hover:bg-void-cyan/[0.06] transition">
          System Atlas →
        </Link>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Pending approvals" value="2" hint="Both flagged by Seccy" accent="amber" />
        <Stat label="Runs overnight" value="34" hint="0 failures" accent="mint" />
        <Stat label="Tokens (24h)" value="218k" hint="68% local" accent="cyan" />
        <Stat label="Memory writes" value="91" hint="Embedded by Dr Strange" accent="violet" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card eyebrow="Helmy briefing" title="Today's priorities" accent="cyan">
            <div className="space-y-3">
              {TODAY_BRIEFING.map((b) => (
                <div key={b.id} className="rounded-lg border border-border bg-background/60 p-4">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <Pill accent={b.priority === 'p0' ? 'crimson' : b.priority === 'p1' ? 'amber' : 'cyan'}>{b.priority.toUpperCase()}</Pill>
                    <span className="font-medium">{b.title}</span>
                    {b.pendingApproval && <Pill accent="amber">awaits approval</Pill>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{b.body}</p>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">via {b.source}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card eyebrow="Assembly Line · scheduled" title="What runs today" accent="mint">
            <ul className="space-y-2 text-sm">
              {[
                ['06:30', 'Morning Briefing', 'Helmy'],
                ['08:00', 'Inbox Triage (continuous)', 'Thinky'],
                ['12:00', 'Midday research sync', 'Velma'],
                ['hourly', 'Security Sweep', 'Seccy'],
                ['23:00', 'Memory Roundup + Obsidian mirror', 'Dr Strange'],
              ].map(([when, label, owner]) => (
                <li key={label} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                  <span className="font-mono text-[11px] text-void-mint w-16">{when}</span>
                  <span className="flex-1">{label}</span>
                  <Pill accent="muted">{owner}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card eyebrow="Helmy" title={helmy.title} accent="cyan">
            <p className="text-sm text-muted-foreground leading-relaxed">{helmy.mission}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Pill accent="cyan">{helmy.primaryModel}</Pill>
              <Pill accent="muted">↓ {helmy.fallbackModel}</Pill>
            </div>
          </Card>

          <Card eyebrow="System pulse" title="All green" accent="mint">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-muted-foreground">MCP gateway</span><Pill accent="mint">live</Pill></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Supabase</span><Pill accent="mint">live</Pill></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Ollama (Mainframe)</span><Pill accent="mint">live</Pill></li>
              <li className="flex justify-between"><span className="text-muted-foreground">WireGuard mesh</span><Pill accent="mint">live</Pill></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Obsidian mirror</span><Pill accent="amber">lag 4m</Pill></li>
            </ul>
          </Card>
        </div>
      </div>
    </DmShell>
  )
}
