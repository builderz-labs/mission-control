'use client'

import { DmShell, Card, Pill } from './shell'

const VAULT_TREE = [
  { name: '00 — Inbox', desc: 'Raw captures awaiting triage', count: 12 },
  { name: '01 — Briefings', desc: 'Daily Helmy briefs (mirror of reports table)', count: 84 },
  { name: '02 — Research', desc: "Velma's synthesized notes", count: 137 },
  { name: '03 — Memory snapshots', desc: 'Nightly summaries from Dr Strange', count: 412 },
  { name: '04 — Decisions', desc: 'ADR-style records of accepted approvals', count: 38 },
  { name: '05 — People', desc: 'Notes on humans the system interacts with', count: 56 },
  { name: '06 — Projects', desc: 'Live initiatives + spec docs', count: 9 },
  { name: '99 — Archive', desc: 'Read-only archive of decommissioned material', count: 203 },
]

export function TheLibrary() {
  return (
    <DmShell
      eyebrow="The Library · Mirror brain"
      title="Obsidian vault"
      subtitle="The readable mirror. Never the source of truth. Edits made here do not flow back automatically — they get re-synced from Supabase nightly."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {VAULT_TREE.map((f) => (
          <Card key={f.name} eyebrow={`${f.count} files`} title={f.name} accent="amber">
            <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
          </Card>
        ))}
      </div>

      <Card eyebrow="Sync status" title="Last mirror cycle" accent="cyan">
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between"><span className="text-muted-foreground">Last run</span><span className="font-mono">23:00 last night</span></li>
          <li className="flex justify-between"><span className="text-muted-foreground">Files written</span><span className="font-mono tabular-nums">47</span></li>
          <li className="flex justify-between"><span className="text-muted-foreground">Files updated</span><span className="font-mono tabular-nums">112</span></li>
          <li className="flex justify-between"><span className="text-muted-foreground">Drift detected</span><Pill accent="amber">3 files edited locally</Pill></li>
        </ul>
        <p className="text-xs text-muted-foreground mt-3 italic">
          Drift = a vault file diverged from its Supabase truth. Will be overwritten on next mirror unless the
          underlying record is updated first.
        </p>
      </Card>
    </DmShell>
  )
}
