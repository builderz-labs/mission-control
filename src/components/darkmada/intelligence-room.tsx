'use client'

import { DmShell, Card, Pill } from './shell'

const REPORTS = [
  {
    title: 'MCP registry — emerging standards',
    body: 'A consortium proposal would standardize tool descriptors across MCP servers. Worth tracking; aligns with our gateway design.',
    sources: 4,
    confidence: 'high',
    pinned: true,
  },
  {
    title: 'Local model landscape — Q2 update',
    body: 'Qwen 3.5 32B remains best-in-class for our reasoning workload. GLM 4.6 closes the gap on long-form. Nemotron tool-calling is improving.',
    sources: 9,
    confidence: 'high',
    pinned: true,
  },
  {
    title: 'Obsidian sync libraries — comparison',
    body: 'Three viable approaches: filesystem write, Obsidian REST plugin, or Sync API. Recommend filesystem write for simplicity + offline support.',
    sources: 6,
    confidence: 'med',
    pinned: false,
  },
  {
    title: 'Mac mini M4 vs M4 Pro for runtime host',
    body: 'M4 Pro 48GB is the sweet spot. Lets us colocate 2-3 local models without thrashing. Saves $700 vs Studio without meaningful loss.',
    sources: 5,
    confidence: 'high',
    pinned: false,
  },
]

export function IntelligenceRoom() {
  return (
    <DmShell
      eyebrow="Intelligence Room · Velma"
      title="Synthesized research"
      subtitle="Velma's working surface. Every report is sourced and confidence-rated. Pinned items shape this week's strategy."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {REPORTS.map((r, i) => (
          <Card key={i} eyebrow={`${r.sources} sources`} title={r.title} accent={r.pinned ? 'amber' : 'cyan'}>
            <p className="text-sm text-muted-foreground leading-relaxed">{r.body}</p>
            <div className="mt-3 flex gap-1.5 flex-wrap">
              <Pill accent={r.confidence === 'high' ? 'mint' : 'amber'}>confidence: {r.confidence}</Pill>
              {r.pinned && <Pill accent="amber">pinned</Pill>}
            </div>
          </Card>
        ))}
      </div>

      <Card eyebrow="Method" title="How Velma works" accent="violet">
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Pull queries from Helmy's brief + standing topics.</li>
          <li>Search via Retrieval Layer + targeted external fetch.</li>
          <li>Synthesize, cite, rate confidence (low / med / high).</li>
          <li>Persist to <code className="text-void-violet">reports</code> table; mirror to Library.</li>
        </ol>
      </Card>
    </DmShell>
  )
}
