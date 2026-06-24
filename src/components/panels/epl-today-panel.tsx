'use client'

/**
 * EPL Today Panel — Gerda's personal landing.
 *
 * v0.1 baseline shipped 26 May 2026 evening — REAL React, no iframe.
 * Jose can replace with Emergent polish later (see EMERGENT_PROMPTS.md §1)
 * by editing this same file. The API contract at /api/epl/today won't change.
 *
 * Data fetched from /api/epl/today; nav buttons follow each item's `deeplink`
 * field so cross-navigation just works.
 *
 * Tailwind classes only (no extra deps); MC fork has Tailwind 3 + dark mode.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Action {
  id: string
  title: string
  why: string
  cta: string
  deeplink: string
}

interface AgentRow {
  name: string
  role: string
  actions: number
  status: 'ok' | 'review' | 'offline'
  headline: string
}

interface Kpi {
  label: string
  value: string
  delta: string
  stale?: boolean
  source?: string
}

interface WaitingItem {
  id: string
  title: string
  age: string
  category: string
  owner: string
}

interface FleetMeta {
  dbConnected: boolean
  dbPath: string
  lastBriefAt: string | null
  lastBriefAge: string | null
  briefStale: boolean
}

interface TodayData {
  generatedAt: string
  fleet?: FleetMeta
  actions: Action[]
  actions_source?: string
  agentsOvernight: AgentRow[]
  agents_source?: string
  agents_last_checked?: string | null
  kpis: Kpi[]
  waitingOnYou: WaitingItem[]
  waiting_source?: string
}

const AGENT_EMOJI: Record<string, string> = {
  sofia: '📨', james: '💰', leo: '📣', victoria: '💼', aria: '💡',
  marcus: '🛡', atlas: '🧭', edward: '🪐', cleo: '💵', iris: '⭐',
  larry: '🤝', nina: '🌱', nathan: '📊', hugo: '🔧', owen: '🔬',
}

export function EplTodayPanel() {
  const router = useRouter()
  const [data, setData] = useState<TodayData | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [todayRes, briefRes] = await Promise.all([
        fetch('/api/epl/today', { cache: 'no-store' }),
        fetch('/api/epl/atlas-brief?format=markdown', { cache: 'no-store' }),
      ])
      if (!todayRes.ok) throw new Error(`HTTP ${todayRes.status}`)
      setData(await todayRes.json())
      if (briefRes.ok) setBrief(await briefRes.text())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const i = setInterval(load, 60_000)
    return () => clearInterval(i)
  }, [load])

  if (loading && !data) {
    return <div className="p-8 text-sm text-slate-500">Loading Today…</div>
  }
  if (error && !data) {
    return (
      <div className="p-8">
        <div className="text-rose-700 font-medium">Failed to load /api/epl/today</div>
        <div className="text-xs text-slate-500 mt-1">{error}</div>
        <button onClick={load} className="mt-3 px-3 py-1 text-sm rounded bg-slate-100 hover:bg-slate-200">Retry</button>
      </div>
    )
  }
  if (!data) return null

  const date = new Date(data.generatedAt).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Greeting */}
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Good morning Gerda</h1>
        <span className="text-slate-500">{date}</span>
        <span className="ml-auto text-xs text-slate-400">
          Generated {new Date(data.generatedAt).toLocaleTimeString('en-GB')} · auto-refresh 60s · <button onClick={load} className="underline hover:text-slate-600">refresh now</button>
        </span>
      </header>

      {/* Fleet data-source status — honest freshness, no silent mock */}
      {data.fleet && (
        <div
          className={`text-xs rounded-xl border px-3 py-2 flex items-center gap-2 ${
            !data.fleet.dbConnected
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : data.fleet.briefStale
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-current opacity-70" />
          {!data.fleet.dbConnected ? (
            <span>atlas.db not reachable ({data.fleet.dbPath}) — live data unavailable, showing only what is wired.</span>
          ) : (
            <span>
              Live from atlas.db · Atlas brief last built {data.fleet.lastBriefAge ?? 'unknown'}
              {data.fleet.briefStale ? ' (STALE — cron may be down)' : ''}.
            </span>
          )}
        </div>
      )}

      {/* Atlas morning brief widget */}
      {brief && (
        <section className="bg-violet-50 border border-violet-200 rounded-2xl">
          <button onClick={() => setBriefOpen(o => !o)} className="w-full px-4 py-3 text-left flex items-center gap-3">
            <span className="text-2xl">📤</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-violet-900">Atlas morning brief</div>
              <div className="text-xs text-violet-700">{briefOpen ? 'Click to collapse' : 'Click to expand — same Markdown the cron posts to Slack at 08:00'}</div>
            </div>
            <span className="text-xs text-violet-700">{briefOpen ? '▾' : '▸'}</span>
          </button>
          {briefOpen && (
            <pre className="px-4 py-3 text-xs text-violet-950 bg-white/60 border-t border-violet-200 whitespace-pre-wrap font-mono leading-relaxed">{brief}</pre>
          )}
        </section>
      )}

      {/* Top 3 Actions */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Top 3 actions</h2>
        {data.actions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-500">
            {data.actions_source === 'atlas-db'
              ? '✓ Nothing in the approvals queue right now.'
              : '⚠ Approvals source offline — cannot show pending actions.'}
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.actions.slice(0, 3).map((a) => (
            <button
              key={a.id}
              onClick={() => router.push(a.deeplink)}
              className="text-left bg-white rounded-2xl border border-slate-200 hover:border-slate-400 hover:shadow-sm p-4 transition"
            >
              <div className="text-sm font-medium text-slate-900">{a.title}</div>
              <div className="text-xs text-slate-600 mt-2">{a.why}</div>
              <div className="text-xs text-emerald-700 mt-3 font-medium">{a.cta} →</div>
            </button>
          ))}
        </div>
        )}
      </section>

      {/* Agents overnight */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Agents overnight
          {data.agents_source === 'atlas-db' && data.agents_last_checked && (
            <span className="ml-2 normal-case text-slate-400">· git/deploy sync, checked {new Date(data.agents_last_checked.replace(' ', 'T') + 'Z').toLocaleString('en-GB')}</span>
          )}
        </h2>
        {data.agents_source !== 'atlas-db' ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800">⚠ agent_state offline — fleet status unavailable.</div>
        ) : (
        <div className="flex flex-wrap gap-2">
          {data.agentsOvernight.map((a) => {
            const dot =
              a.status === 'ok' ? 'bg-emerald-500'
              : a.status === 'review' ? 'bg-amber-500'
              : 'bg-slate-400'
            return (
              <button
                key={a.name}
                onClick={() => router.push(`/agents-fleet`)}
                title={a.headline}
                className="flex items-center gap-2 bg-white rounded-full border border-slate-200 px-3 py-1 text-sm hover:border-slate-400"
              >
                <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                <span>{AGENT_EMOJI[a.name] ?? '🤖'}</span>
                <span className="font-medium capitalize">{a.name}</span>
                <span className="text-xs text-slate-500">· {a.role}</span>
                <span className="text-xs text-slate-400">({a.actions})</span>
              </button>
            )
          })}
        </div>
        )}
      </section>

      {/* KPIs */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">KPIs</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {data.kpis.map((k) => (
            <div key={k.label} className={`rounded-2xl border p-4 ${k.stale ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
              <div className="text-xs uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className={`mt-1 text-2xl font-semibold ${k.stale ? 'text-amber-900' : ''}`}>{k.value}</div>
              <div className={`text-xs mt-1 ${k.stale ? 'text-amber-700' : 'text-slate-500'}`}>{k.delta}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Waiting on you */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Waiting on you</h2>
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">id</th>
                <th className="text-left px-4 py-2 font-medium">title</th>
                <th className="text-left px-4 py-2 font-medium">age</th>
                <th className="text-left px-4 py-2 font-medium">category</th>
                <th className="text-left px-4 py-2 font-medium">owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.waitingOnYou.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-sm text-slate-500">
                    {data.waiting_source === 'atlas-db'
                      ? '✓ Nothing waiting on you — approvals queue is empty.'
                      : '⚠ Approvals source offline.'}
                  </td>
                </tr>
              )}
              {data.waitingOnYou.map((w) => {
                const days = parseInt(w.age, 10) || 0
                const ageClass =
                  days >= 7 ? 'bg-rose-100 text-rose-800'
                  : days >= 2 ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
                return (
                  <tr
                    key={w.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push(`/decisions?id=${w.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{w.id}</td>
                    <td className="px-4 py-3">{w.title}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${ageClass}`}>{w.age}</span></td>
                    <td className="px-4 py-3 text-slate-600">{w.category}</td>
                    <td className="px-4 py-3 text-slate-600">{w.owner}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Aggregator source: <code>/api/epl/today</code>. v0.1 baseline React — Emergent polish welcome (see EMERGENT_PROMPTS.md §1).
      </footer>
    </div>
  )
}
