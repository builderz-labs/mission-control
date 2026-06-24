'use client'

/**
 * EPL Decisions Panel — v0.1 real React.
 *
 * Gerda's throughput bottleneck. Renders 32 decisions grouped by category,
 * age-risk callout at the top, drawer with Atlas recommendation + Approve /
 * Reject / Discuss buttons that POST to /api/epl/decisions/[id]/decision.
 */

import { useEffect, useState, useCallback } from 'react'

interface Decision {
  id: string
  title: string
  category: string
  status: 'open' | 'decided' | 'blocked'
  age_days: number
  owner: string
  recommendation?: string
  default_applied?: string
}

const STATUS_CLASS: Record<string, string> = {
  open:    'bg-amber-100 text-amber-800',
  decided: 'bg-emerald-100 text-emerald-800',
  blocked: 'bg-slate-100 text-slate-600',
}

const CAT_ICON: Record<string, string> = {
  Hugo: '🔧', Rapid: '⚡', Architecture: '📐',
  'AI Policies': '🛡', 'MC build': '🖥', Maintenance: '🧰',
}

function ageBadge(days: number) {
  if (days >= 10) return 'bg-rose-100 text-rose-800'
  if (days >= 3) return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-800'
}

export function EplDecisionsPanel() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/epl/decisions', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDecisions(data.decisions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const open = decisions?.find(d => d.id === openId) ?? null
  const stale = decisions?.filter(d => d.status === 'open' && d.age_days > 10) ?? []
  const counts = {
    total: decisions?.length ?? 0,
    open: decisions?.filter(d => d.status === 'open').length ?? 0,
    decided: decisions?.filter(d => d.status === 'decided').length ?? 0,
    blocked: decisions?.filter(d => d.status === 'blocked').length ?? 0,
  }

  async function takeAction(id: string, action: 'approve' | 'reject' | 'discuss') {
    setActionResult(null)
    try {
      const res = await fetch(`/api/epl/decisions/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      setActionResult(res.ok ? `✅ ${action} recorded (${json.audit_id ?? 'no audit id'})` : `❌ ${json.error ?? 'failed'}`)
      if (res.ok) load()
    } catch (e) {
      setActionResult(`❌ ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  if (error) return <div className="p-8 text-rose-700">Failed: {error}</div>
  if (!decisions) return <div className="p-8 text-sm text-slate-500">Loading decisions…</div>

  const groups: Record<string, Decision[]> = {}
  decisions.forEach(d => { (groups[d.category] ||= []).push(d) })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🎯 Decisions</h1>
        <span className="text-slate-500">{counts.total} total · {counts.open} open · {counts.decided} decided · {counts.blocked} blocked</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      {stale.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
          <div className="font-medium text-rose-900">⚠️ {stale.length} decisions open &gt;10 days</div>
          <div className="mt-2 space-y-1 text-sm">
            {stale.map(d => (
              <button key={d.id} onClick={() => setOpenId(d.id)} className="block text-left text-rose-800 hover:underline">
                [{d.id}] {d.title} — <b>{d.age_days}d</b> (owner: {d.owner})
              </button>
            ))}
          </div>
        </div>
      )}

      {Object.entries(groups).map(([cat, items]) => (
        <section key={cat}>
          <h2 className="text-sm font-medium text-slate-700 mb-2">{CAT_ICON[cat] ?? '•'} {cat} <span className="text-xs text-slate-400">({items.length})</span></h2>
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {items.map(d => (
              <button key={d.id} onClick={() => setOpenId(d.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3">
                <span className="font-mono text-xs text-slate-500 w-12">{d.id}</span>
                <span className="flex-1">{d.title}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CLASS[d.status]}`}>{d.status}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${ageBadge(d.age_days)}`}>{d.age_days}d</span>
                <span className="text-xs text-slate-500 w-32 truncate text-right">{d.owner}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/decisions</code> · approve POSTs to <code>/api/epl/decisions/[id]/decision</code>
      </footer>

      {open && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenId(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[520px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-slate-500">{open.id} · {open.category}</div>
                  <h2 className="text-xl font-semibold mt-1">{open.title}</h2>
                </div>
                <button onClick={() => setOpenId(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>

              <div className="flex gap-2 flex-wrap text-xs">
                <span className={`px-2 py-1 rounded-full ${STATUS_CLASS[open.status]}`}>{open.status}</span>
                <span className={`px-2 py-1 rounded-full ${ageBadge(open.age_days)}`}>{open.age_days}d</span>
                <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">owner: {open.owner}</span>
              </div>

              {open.recommendation && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-violet-900 mb-1">🤖 Atlas recommendation</div>
                  <div className="text-sm text-violet-900">{open.recommendation}</div>
                </div>
              )}
              {open.default_applied && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-emerald-900 mb-1">✓ Default applied</div>
                  <div className="text-sm text-emerald-900">{open.default_applied}</div>
                </div>
              )}

              {open.status === 'open' && (
                <div className="flex gap-2">
                  <button onClick={() => takeAction(open.id, 'approve')} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700">🟢 Approve</button>
                  <button onClick={() => takeAction(open.id, 'reject')} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-700">🔴 Reject</button>
                  <button onClick={() => takeAction(open.id, 'discuss')} className="px-4 py-2 rounded-lg bg-slate-200 text-slate-800 text-sm hover:bg-slate-300">💬 Discuss</button>
                </div>
              )}
              {actionResult && <div className="text-sm">{actionResult}</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
