'use client'

/**
 * EPL Agent Cockpit — Agent feed.
 *
 * Live hand-off feed between agents: from → to chips + summary + cost. Plus a
 * per-conversation cost table (cost / turns / last activity) so spend is visible
 * at the conversation grain alongside the agent cost cards.
 *
 * Read-only. Source: /api/epl/cockpit (Atlas export). Empty export → honest
 * empty state.
 */

import { useEffect, useState, useCallback } from 'react'

interface FeedEntry {
  ts: string
  from: string
  to: string
  summary: string
  kind: string
  cost_usd: number
}
interface Conversation {
  id: string
  agent: string
  cost_usd: number
  turns: number
  last_ts: string
  title: string
}
interface CockpitData {
  generated_at: string
  week_now: number
  agent_feed: FeedEntry[]
  conversations: Conversation[]
  source: 'live' | 'empty'
}

const KIND_CLASS: Record<string, string> = {
  handoff:  'bg-blue-500/15 text-blue-200 border-blue-500/30',
  escalate: 'bg-rose-500/15 text-rose-200 border-rose-500/30',
  approval: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  notify:   'bg-secondary text-secondary-foreground border-border',
}

const money = (v: number) => `$${(v ?? 0).toFixed(2)}`

function ago(ts: string): string {
  const t = new Date(ts).getTime()
  if (isNaN(t)) return '—'
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function EplAgentFeedPanel() {
  const [data, setData] = useState<CockpitData | null>(null)

  const load = useCallback(async () => {
    const d = await fetch('/api/epl/cockpit', { cache: 'no-store' }).then(r => r.json())
    setData(d)
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading agent feed…</div>

  const feed = [...data.agent_feed].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  const convs = [...data.conversations].sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0))
  const feedCost = feed.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
  const convCost = convs.reduce((s, c) => s + (c.cost_usd ?? 0), 0)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🔀 Agent feed</h1>
        <span className="text-muted-foreground">{feed.length} hand-offs · {money(feedCost)}</span>
        {data.source === 'empty' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">waiting on Atlas export</span>
        )}
        <button onClick={load} className="ml-auto text-xs underline text-muted-foreground hover:text-foreground">refresh</button>
      </header>

      {/* Hand-off chips */}
      <section className="space-y-2">
        {feed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No hand-offs yet — populates once Atlas writes the cockpit export.
          </div>
        ) : (
          feed.map((e, i) => (
            <div key={i} className="flex items-center gap-3 bg-card rounded-2xl border border-border px-4 py-3">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${KIND_CLASS[e.kind] ?? KIND_CLASS.notify}`}>{e.kind}</span>
              <span className="text-sm font-medium text-foreground capitalize">{e.from}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-sm font-medium text-foreground capitalize">{e.to}</span>
              <span className="text-sm text-muted-foreground truncate flex-1">{e.summary}</span>
              <span className="text-xs tabular-nums text-foreground">{money(e.cost_usd)}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{ago(e.ts)}</span>
            </div>
          ))
        )}
      </section>

      {/* Per-conversation cost */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium text-foreground">💬 Conversations</h2>
          <span className="text-xs text-muted-foreground">{convs.length} · {money(convCost)} total</span>
        </div>
        {convs.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">none</div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-4 py-2">Conversation</th>
                  <th className="text-left font-medium px-4 py-2">Agent</th>
                  <th className="text-right font-medium px-4 py-2">Turns</th>
                  <th className="text-right font-medium px-4 py-2">Cost</th>
                  <th className="text-right font-medium px-4 py-2">Last</th>
                </tr>
              </thead>
              <tbody>
                {convs.map(c => (
                  <tr key={c.id} className="border-b border-border/50 last:border-b-0">
                    <td className="px-4 py-2 text-foreground"><span className="truncate block max-w-[320px]">{c.title || c.id}</span><span className="text-[11px] text-muted-foreground">{c.id}</span></td>
                    <td className="px-4 py-2 text-foreground capitalize">{c.agent}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{c.turns}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-foreground">{money(c.cost_usd)}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{ago(c.last_ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-xs text-muted-foreground pt-2">
        Source: <code>/api/epl/cockpit</code> · {data.source === 'live' ? `live · generated ${new Date(data.generated_at).toLocaleString()}` : 'empty (no export yet)'}
      </footer>
    </div>
  )
}
