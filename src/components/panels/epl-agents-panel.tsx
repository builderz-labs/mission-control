'use client'

/**
 * EPL Agents (fleet) Panel — v0.1 real React.
 *
 * Closes Gerda's long-open "tracker for agents" ask. Fetches /api/epl/agents,
 * renders the fleet table, opens per-agent drawer on click (drawer fetches
 * /api/epl/agents/[name]). Tailwind only.
 */

import { useEffect, useState, useCallback } from 'react'

interface AgentRow {
  name: string
  role: string
  category: string
  phase: string
  status: 'ok' | 'review' | 'offline' | 'blocked'
  last_action: string
  roadmap_age_days: number
  kpi_count: number
  headline: string
  stats_source: 'live' | 'mock'
}

const STATUS_CLASS: Record<string, string> = {
  ok:       'bg-emerald-100 text-emerald-800',
  review:   'bg-amber-100 text-amber-800',
  offline:  'bg-slate-100 text-slate-600',
  blocked:  'bg-rose-100 text-rose-800',
}

const CAT_CLASS: Record<string, string> = {
  PA: 'bg-violet-100 text-violet-800', Finance: 'bg-emerald-100 text-emerald-800',
  Marketing: 'bg-pink-100 text-pink-800', Revenue: 'bg-blue-100 text-blue-800',
  Pricing: 'bg-cyan-100 text-cyan-800', Compliance: 'bg-rose-100 text-rose-800',
  CoS: 'bg-amber-100 text-amber-800', Meta: 'bg-purple-100 text-purple-800',
  Cash: 'bg-emerald-100 text-emerald-800', QA: 'bg-yellow-100 text-yellow-800',
  Landlord: 'bg-indigo-100 text-indigo-800', Onboarding: 'bg-pink-100 text-pink-800',
  Acquisition: 'bg-cyan-100 text-cyan-800', Maintenance: 'bg-orange-100 text-orange-800',
  Research: 'bg-violet-100 text-violet-800',
}

const EMOJI: Record<string, string> = {
  sofia: '📨', james: '💰', leo: '📣', victoria: '💼', aria: '💡',
  marcus: '🛡', atlas: '🧭', edward: '🪐', cleo: '💵', iris: '⭐',
  larry: '🤝', nina: '🌱', nathan: '📊', hugo: '🔧', owen: '🔬',
}

function ageBadge(days: number) {
  if (days >= 7) return 'bg-rose-100 text-rose-800'
  if (days >= 3) return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-800'
}

export function EplAgentsPanel() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openName, setOpenName] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<any>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/agents', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setAgents(data.agents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!openName) { setDrawer(null); return }
    setDrawer(null)
    fetch(`/api/epl/agents/${openName}`, { cache: 'no-store' })
      .then(r => r.json()).then(setDrawer).catch(() => setDrawer({ error: 'fetch failed' }))
  }, [openName])

  if (error) return <div className="p-8 text-rose-700">Failed: {error}</div>
  if (!agents) return <div className="p-8 text-sm text-slate-500">Loading agents…</div>

  const stale = agents.filter(a => a.roadmap_age_days > 7)
  const counts = {
    total: agents.length,
    ok: agents.filter(a => a.status === 'ok').length,
    review: agents.filter(a => a.status === 'review').length,
    offline: agents.filter(a => a.status === 'offline').length,
    stale: stale.length,
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🤖 Agents (fleet)</h1>
        <span className="text-slate-500">{counts.total} agents · {counts.ok} healthy · {counts.review} review · {counts.offline} offline</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      {/* Stale ROADMAP callout */}
      {stale.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="font-medium text-amber-900">⚠️ {stale.length} agents have stale ROADMAPs (&gt;7d)</div>
          <div className="text-sm text-amber-800 mt-1">Edward's Friday scan flags these. Refresh in the same session you ship code.</div>
          <div className="mt-3 flex gap-2 flex-wrap text-xs">
            {stale.map(a => (
              <span key={a.name} className="px-2 py-1 rounded-full bg-rose-100 text-rose-800 font-medium">{a.name} {a.roadmap_age_days}d</span>
            ))}
          </div>
        </div>
      )}

      {/* Fleet table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Agent</th>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Phase</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">ROADMAP</th>
              <th className="text-left px-4 py-2 font-medium">KPIs</th>
              <th className="text-left px-4 py-2 font-medium">Headline</th>
              <th className="text-left px-4 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map(a => (
              <tr key={a.name} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenName(a.name)}>
                <td className="px-4 py-3 font-medium">{EMOJI[a.name] ?? '🤖'} {a.name}</td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs ${CAT_CLASS[a.category] ?? 'bg-slate-100 text-slate-700'}`}>{a.category}</span></td>
                <td className="px-4 py-3 text-slate-600">{a.phase}</td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs ${STATUS_CLASS[a.status]}`}>{a.status}</span></td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs ${ageBadge(a.roadmap_age_days)}`}>{a.roadmap_age_days}d</span></td>
                <td className="px-4 py-3 text-slate-600">{a.kpi_count}</td>
                <td className="px-4 py-3 text-slate-600">{a.headline}</td>
                <td className="px-4 py-3"><span className={`text-xs ${a.stats_source === 'live' ? 'text-emerald-700' : 'text-slate-400'}`}>{a.stats_source}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/agents</code> · drawer fetches <code>/api/epl/agents/[name]</code>
      </footer>

      {/* Drawer */}
      {openName && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenName(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[480px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">{EMOJI[openName] ?? '🤖'} {openName}</h2>
                <button onClick={() => setOpenName(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              {!drawer && <div className="text-sm text-slate-500">Loading per-agent stats…</div>}
              {drawer?.error && <div className="text-rose-700">Error: {drawer.error}</div>}
              {drawer && !drawer.error && (
                <>
                  <div className="text-xs text-slate-500">Stats source: <span className={drawer.stats_source === 'live' ? 'text-emerald-700' : 'text-slate-400'}>{drawer.stats_source}</span></div>
                  <div className="text-xs text-slate-500">ROADMAP age: {drawer.roadmap_age_days ?? 'n/a'} days</div>
                  {drawer.stats_url && <div className="text-xs text-slate-400">URL: <code>{drawer.stats_url}</code></div>}
                  <pre className="text-xs bg-slate-50 rounded-lg p-3 overflow-auto">{JSON.stringify(drawer.stats, null, 2)}</pre>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
