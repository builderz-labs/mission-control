'use client'

/**
 * EPL "START HERE" Panel — v0.1.
 *
 * Onboarding entry-point for any new contributor (Gerda's other laptop, EPL team
 * accounts, future Staylio Claude, cold-start Claude Code sessions). Fetches
 * /api/epl/start-here and renders:
 *   - intro:        who reads this + 5 principles
 *   - agents:       grid of 16 cards (click to expand: purpose · integrations · pick-up)
 *   - integrations: cross-cutting services + owners + setup notes
 *   - references:   canonical sheets / dashboards / repos
 *   - how-to:       add new agent  /  pick up existing one
 *
 * Sister panel to /agents-fleet — that panel says "is it healthy", this one says
 * "what is it for and where do I start".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AgentEntry {
  name: string
  emoji: string
  role: string
  category: string
  purpose: string
  key_integrations: string[]
  repo_path: string
  how_to_pick_up: string
  blocked_on: string | null
}

interface Integration {
  name: string
  used_by: string[]
  who_owns: string
  setup_notes: string
}

interface Reference {
  name: string
  url: string
  purpose: string
}

interface StartHereData {
  generatedAt: string
  intro: {
    who_should_read: string
    one_liner: string
    principles: string[]
  }
  agents: AgentEntry[]
  integrations: Integration[]
  references: Reference[]
  how_to_add_agent: string[]
  how_to_pick_up_existing: string[]
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

export function EplStartHerePanel() {
  const [data, setData] = useState<StartHereData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openAgent, setOpenAgent] = useState<string | null>(null)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showPickUp, setShowPickUp] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/start-here', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openAgentEntry = useMemo(
    () => (openAgent && data ? data.agents.find(a => a.name === openAgent) ?? null : null),
    [openAgent, data],
  )

  if (error) return <div className="p-8 text-rose-700">Failed: {error}</div>
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading start-here…</div>

  const blockedCount = data.agents.filter(a => a.blocked_on).length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Hero */}
      <header className="space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight">📍 Start Here</h1>
          <span className="text-slate-500 text-sm">{data.agents.length} agents · {data.integrations.length} integrations · {blockedCount} blocked</span>
          <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
        </div>
        <p className="text-slate-700 text-base leading-relaxed">{data.intro.one_liner}</p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          <strong>Who reads this:</strong> {data.intro.who_should_read}
        </div>
      </header>

      {/* Principles */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Principles (read before building)</h2>
        <ul className="space-y-2">
          {data.intro.principles.map((p, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="text-slate-400 font-mono w-6 shrink-0">{i + 1}.</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Agents grid */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Agents — click a card for purpose · integrations · pick-up</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.agents.map(a => (
            <button
              key={a.name}
              onClick={() => setOpenAgent(a.name)}
              className="text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-slate-400 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{a.emoji} {a.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{a.role}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${CAT_CLASS[a.category] ?? 'bg-slate-100 text-slate-700'}`}>
                  {a.category}
                </span>
              </div>
              <div className="text-sm text-slate-700 mt-3 line-clamp-3">{a.purpose}</div>
              {a.blocked_on && (
                <div className="text-xs text-rose-700 mt-2">🚧 Blocked: {a.blocked_on}</div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Integrations */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Integrations — who owns what</h2>
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Integration</th>
                <th className="text-left px-4 py-2 font-medium">Used by</th>
                <th className="text-left px-4 py-2 font-medium">Owner</th>
                <th className="text-left px-4 py-2 font-medium">Setup / notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.integrations.map(int => (
                <tr key={int.name} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{int.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex gap-1 flex-wrap">
                      {int.used_by.map(u => (
                        <span key={u} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">{u}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{int.who_owns}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{int.setup_notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* References */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Key references</h2>
        <ul className="space-y-2">
          {data.references.map(r => (
            <li key={r.name} className="flex flex-col gap-0.5 bg-white rounded-xl border border-slate-200 p-3">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline text-sm">
                {r.name} ↗
              </a>
              <div className="text-xs text-slate-600">{r.purpose}</div>
            </li>
          ))}
        </ul>
      </section>

      {/* How-to: pick up existing */}
      <section>
        <button
          onClick={() => setShowPickUp(v => !v)}
          className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-4 hover:bg-emerald-100 transition"
        >
          <span className="font-medium text-emerald-900">📥 How to pick up an existing agent</span>
          <span className="text-emerald-700">{showPickUp ? '−' : '+'}</span>
        </button>
        {showPickUp && (
          <ol className="mt-3 space-y-2 px-2">
            {data.how_to_pick_up_existing.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="text-slate-400 font-mono w-6 shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* How-to: add new agent */}
      <section>
        <button
          onClick={() => setShowAddAgent(v => !v)}
          className="w-full flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl p-4 hover:bg-violet-100 transition"
        >
          <span className="font-medium text-violet-900">➕ How to add a NEW agent</span>
          <span className="text-violet-700">{showAddAgent ? '−' : '+'}</span>
        </button>
        {showAddAgent && (
          <ol className="mt-3 space-y-2 px-2">
            {data.how_to_add_agent.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="text-slate-400 font-mono w-6 shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/start-here</code> · generated {new Date(data.generatedAt).toLocaleString()}
      </footer>

      {/* Agent drawer */}
      {openAgentEntry && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenAgent(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[520px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">{openAgentEntry.emoji} {openAgentEntry.name}</h2>
                <button onClick={() => setOpenAgent(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div className="flex gap-2 items-center text-sm text-slate-600">
                <span className={`px-2 py-0.5 rounded-full text-xs ${CAT_CLASS[openAgentEntry.category] ?? 'bg-slate-100 text-slate-700'}`}>
                  {openAgentEntry.category}
                </span>
                <span>{openAgentEntry.role}</span>
              </div>

              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">Purpose</div>
                <p className="text-sm text-slate-700 leading-relaxed">{openAgentEntry.purpose}</p>
              </div>

              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">Key integrations</div>
                <div className="flex gap-1 flex-wrap">
                  {openAgentEntry.key_integrations.map(int => (
                    <span key={int} className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700">{int}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">Repo path</div>
                <code className="text-xs bg-slate-50 rounded px-2 py-1 inline-block">{openAgentEntry.repo_path}</code>
              </div>

              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">How to pick up</div>
                <p className="text-sm text-slate-700 leading-relaxed">{openAgentEntry.how_to_pick_up}</p>
              </div>

              {openAgentEntry.blocked_on && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                  <div className="text-xs uppercase text-rose-700 mb-1">Blocked on</div>
                  <p className="text-sm text-rose-900">{openAgentEntry.blocked_on}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
