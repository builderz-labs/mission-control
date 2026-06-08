'use client'

/**
 * EPL Team Panel — "agents + humans building together".
 *
 * The humans half of the shared brain: every person, their paired agents, and
 * open hand-offs. Source: /api/epl/team → Supabase brain
 * (public.people / agent_human_pairings / handoffs).
 *
 * Internal, auth-gated dashboard — Slack IDs / emails shown in the drawer only.
 */

import { useEffect, useState, useCallback } from 'react'

interface Pairing { agent: string; pair_role: string | null }
interface Person {
  id: string; name: string; role: string | null; company: string | null
  location: string | null; line_manager: string | null
  slack_user_id: string | null; email: string | null
  status: string; notes: string | null
  paired_agents: Pairing[]
}
interface Handoff {
  id: number; trigger: string; from_actor: string; to_actor: string
  status: string; sla: string | null; summary: string | null
}

const COMPANY_CLASS: Record<string, string> = {
  EPL: 'bg-blue-100 text-blue-800',
  Staylio: 'bg-purple-100 text-purple-800',
  NourNest: 'bg-pink-100 text-pink-800',
  UrbanReady: 'bg-amber-100 text-amber-800',
}
function companyClass(c?: string | null) {
  if (!c) return 'bg-slate-100 text-slate-700'
  const key = Object.keys(COMPANY_CLASS).find(k => c.includes(k))
  return key ? COMPANY_CLASS[key] : 'bg-slate-100 text-slate-700'
}

export function EplTeamPanel() {
  const [data, setData] = useState<any>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const d = await fetch('/api/epl/team', { cache: 'no-store' }).then(r => r.json())
    setData(d)
  }, [])
  useEffect(() => { load() }, [load])

  if (!data) return <div className="p-8 text-sm text-slate-500">Loading team…</div>

  if (data.source === 'unconfigured') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">👥 Team</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Brain not configured. Set <code>EPL_BRAIN_KEY</code> (Supabase service_role) in Mission Control’s
          env to read <code>public.people / agent_human_pairings / handoffs</code>.
        </div>
      </div>
    )
  }

  const people: Person[] = data.people ?? []
  const handoffs: Handoff[] = data.handoffs ?? []
  const s = data.summary ?? {}
  const open = people.find(p => p.id === openId)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">👥 Team</h1>
        <span className="text-slate-500">{s.people} people · {s.active} active · {s.agents_paired} agents paired</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="People" value={String(s.people ?? 0)} />
        <Kpi label="Active" value={String(s.active ?? 0)} />
        <Kpi label="Agents paired" value={String(s.agents_paired ?? 0)} />
        <Kpi label="Open hand-offs" value={String(s.open_handoffs ?? 0)} />
      </div>

      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">People &amp; their agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {people.map(p => (
            <button key={p.id} onClick={() => setOpenId(p.id)}
              className={`text-left p-4 rounded-2xl border bg-white hover:shadow-md transition ${p.status === 'left' ? 'border-rose-200 opacity-60' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">{p.name}</div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${companyClass(p.company)}`}>{p.company ?? '—'}</span>
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5">{p.role ?? '—'}</div>
              {p.status === 'left' && <div className="text-[10px] text-rose-600 mt-1 uppercase tracking-wide">left — do not contact</div>}
              <div className="flex flex-wrap gap-1 mt-2">
                {p.paired_agents.length === 0 && <span className="text-[11px] text-slate-400 italic">no agents</span>}
                {p.paired_agents.map((a, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-700">
                    {a.agent === '*' ? 'all' : a.agent}{a.pair_role ? <span className="text-slate-400"> · {a.pair_role}</span> : null}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Open hand-offs</h2>
        {handoffs.length === 0
          ? <div className="text-xs text-slate-400 italic">No open hand-offs. Agents write here when they route work to a named human.</div>
          : (
            <div className="space-y-2">
              {handoffs.map(h => (
                <div key={h.id} className="bg-white rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px]">{h.from_actor}</span>
                    <span className="text-slate-400">→</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px]">{h.to_actor}</span>
                    <span className="text-slate-600">{h.trigger}</span>
                    {h.sla && <span className="ml-auto text-[11px] text-slate-400">SLA {h.sla}</span>}
                  </div>
                  {h.summary && <div className="text-xs text-slate-500 mt-1">{h.summary}</div>}
                </div>
              ))}
            </div>
          )}
      </section>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/team</code> · brain: Supabase <code>people / agent_human_pairings / handoffs</code> · live roster: Org Sheet Roster tab
      </footer>

      {open && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenId(null)}>
          <aside className="absolute right-0 top-0 bottom-0 w-full md:w-[480px] bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{open.name}</h2>
                  <div className="text-sm text-slate-500">{open.role ?? '—'}</div>
                </div>
                <button onClick={() => setOpenId(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
              </div>
              <div className="flex gap-2 flex-wrap text-xs">
                <span className={`px-2 py-1 rounded-full ${companyClass(open.company)}`}>{open.company ?? '—'}</span>
                {open.location && <span className="px-2 py-1 rounded-full bg-slate-100">📍 {open.location}</span>}
                <span className={`px-2 py-1 rounded-full ${open.status === 'left' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'}`}>{open.status}</span>
              </div>
              <Field label="Line manager" value={open.line_manager} />
              <Field label="Email" value={open.email} />
              <Field label="Slack user ID" value={open.slack_user_id} />
              <div>
                <div className="text-xs font-medium text-slate-700 mb-1">Paired agents</div>
                <div className="flex flex-wrap gap-1">
                  {open.paired_agents.length === 0 && <span className="text-xs text-slate-400 italic">none</span>}
                  {open.paired_agents.map((a, i) => (
                    <span key={i} className="px-2 py-1 rounded-full bg-slate-100 text-xs">{a.agent === '*' ? 'all agents' : a.agent}{a.pair_role ? ` · ${a.pair_role}` : ''}</span>
                  ))}
                </div>
              </div>
              {open.notes && <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600">{open.notes}</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <div className="text-slate-700 break-all">{value}</div>
    </div>
  )
}
