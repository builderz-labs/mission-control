'use client'

/**
 * EPL Maintenance Panel — v0.1 real React.
 *
 * Hugo Phase 3 home. KPI strip (Hugo live/offline) + 5-col Kanban + per-
 * property heat map. Click ticket → drawer fetches /api/epl/maintenance/[id].
 */

import { useEffect, useState, useCallback } from 'react'

interface Ticket {
  id: string
  property: string
  summary: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  status: string
  assignee: string
  age_hours: number
  ts: string
}

interface Summary {
  ok: boolean
  open_total: number
  open_p0: number
  open_p1: number
  awaiting_parts_aged_gt7d: number
  hugo_status: 'live' | 'offline'
}

const SEV_CLASS: Record<string, string> = {
  P0: 'bg-rose-600 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-amber-400 text-amber-950',
  P3: 'bg-slate-300 text-slate-800',
}

const COL_LABELS: Record<string, string> = {
  inbox: 'Inbox', in_progress: 'In progress', awaiting_parts: 'Awaiting parts',
  resolved_this_week: 'Resolved this wk', cancelled: 'Cancelled',
}

function statusBucket(s: string) {
  if (s === 'open') return 'inbox'
  if (s === 'in_progress') return 'in_progress'
  if (s === 'awaiting_parts') return 'awaiting_parts'
  if (['resolved', 'verified', 'closed'].includes(s)) return 'resolved_this_week'
  if (s === 'cancelled') return 'cancelled'
  return 'inbox'
}

function ageBadge(h: number) {
  if (h >= 168) return 'bg-rose-100 text-rose-800'
  if (h >= 48) return 'bg-amber-100 text-amber-800'
  if (h >= 12) return 'bg-yellow-100 text-yellow-800'
  return 'bg-emerald-100 text-emerald-800'
}

export function EplMaintenancePanel() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<any>(null)

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetch('/api/epl/maintenance', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/epl/maintenance?part=summary', { cache: 'no-store' }).then(r => r.json()),
    ])
    setTickets(t.tickets ?? [])
    setSummary(s)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!openId) { setDrawer(null); return }
    setDrawer(null)
    fetch(`/api/epl/maintenance/${openId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : r.json().then((j) => Promise.reject(j)))
      .then(setDrawer)
      .catch(j => setDrawer({ error: j?.error ?? 'fetch failed', hint: j?.hint }))
  }, [openId])

  if (!tickets || !summary) return <div className="p-8 text-sm text-slate-500">Loading maintenance…</div>

  const cols: Record<string, Ticket[]> = { inbox: [], in_progress: [], awaiting_parts: [], resolved_this_week: [], cancelled: [] }
  tickets.forEach(t => cols[statusBucket(t.status)].push(t))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">🔧 Maintenance</h1>
        <span className={`px-2 py-1 rounded-full text-xs ${summary.hugo_status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>Hugo {summary.hugo_status === 'live' ? '🟢 live' : '🔴 offline (no live feed)'}</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open total" value={String(summary.open_total)} />
        <Kpi label="P0 open" value={String(summary.open_p0)} tone={summary.open_p0 > 0 ? 'rose' : 'slate'} />
        <Kpi label="P1 open" value={String(summary.open_p1)} tone={summary.open_p1 > 0 ? 'orange' : 'slate'} />
        <Kpi label="Awaiting parts >7d" value={String(summary.awaiting_parts_aged_gt7d)} tone={summary.awaiting_parts_aged_gt7d > 0 ? 'amber' : 'slate'} />
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {Object.entries(cols).map(([col, items]) => (
          <div key={col} className="bg-slate-50 rounded-2xl border border-slate-200 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-600 mb-2">{COL_LABELS[col]} <span className="text-slate-400">({items.length})</span></div>
            <div className="space-y-2">
              {items.map(t => (
                <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left bg-white rounded-xl border border-slate-200 hover:border-slate-400 p-3 transition">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEV_CLASS[t.severity]}`}>{t.severity}</span>
                    <span className="text-xs text-slate-500 truncate">{t.property}</span>
                  </div>
                  <div className="text-sm mt-2">{t.summary}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-slate-500">@{t.assignee}</span>
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-xs ${ageBadge(t.age_hours)}`}>{t.age_hours}h</span>
                  </div>
                </button>
              ))}
              {items.length === 0 && <div className="text-xs text-slate-400 italic">empty</div>}
            </div>
          </div>
        ))}
      </div>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/maintenance</code> · drawer fetches <code>/api/epl/maintenance/[id]</code> · Hugo proxy: <code>/api/epl/maintenance?part=summary</code> tries Hugo /api/stats first
      </footer>

      {openId && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenId(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[520px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">Ticket {openId}</h2>
                <button onClick={() => setOpenId(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>
              {!drawer && <div className="text-sm text-slate-500">Loading ticket detail…</div>}
              {drawer?.error && (
                <div className="text-rose-700">
                  <div>Error: {drawer.error}</div>
                  {drawer.hint && <div className="text-xs text-slate-500 mt-1">{drawer.hint}</div>}
                </div>
              )}
              {drawer && !drawer.error && (
                <>
                  <div className="flex gap-2 flex-wrap text-xs">
                    <span className={`px-2 py-1 rounded font-semibold ${SEV_CLASS[drawer.severity]}`}>{drawer.severity}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">{drawer.status}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">@{drawer.assignee?.name}</span>
                  </div>
                  <div className="text-sm text-slate-600">{drawer.property?.display_name} <span className="text-xs text-slate-400">({drawer.property?.canonical_id})</span></div>
                  <div className="text-base font-medium">{drawer.summary}</div>
                  <div className="text-sm">{drawer.description}</div>
                  {drawer.parser && (
                    <div className="bg-slate-50 rounded-xl p-3 text-xs">
                      <div className="font-medium text-slate-700 mb-1">📱 Parser source ({drawer.parser.source})</div>
                      <div className="text-slate-600 italic">"{drawer.parser.raw_text}"</div>
                      <div className="text-slate-400 mt-1">{drawer.parser.parsed_by} · confidence {drawer.parser.confidence}</div>
                    </div>
                  )}
                  {drawer.timeline?.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-700 mb-2">Timeline</div>
                      <ol className="space-y-1 text-xs text-slate-600">
                        {drawer.timeline.map((e: any, i: number) => (
                          <li key={i}><span className="text-slate-400">{new Date(e.ts).toLocaleTimeString('en-GB')}</span> · <b>{e.event}</b> — {e.detail}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'rose' | 'orange' | 'amber' }) {
  const cls = tone === 'rose' ? 'text-rose-700' : tone === 'orange' ? 'text-orange-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  )
}
