'use client'

/**
 * EPL Projects Panel — v0.1 real React.
 *
 * 6-col Kanban that replaces Asana for the agent fleet (Wk4 target).
 * Cards drag-droppable across cols (state local for now; persistence TODO
 * when MC tasks table is wired). Click card → expand inline.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Card {
  id: string
  title: string
  owner: string
  tags: string[]
  age: string
}

interface Column {
  id: string
  label: string
  cards: Card[]
}

const OWNER_EMOJI: Record<string, string> = {
  Sofia: '📨', James: '💰', Leo: '📣', Victoria: '💼', Aria: '💡',
  Marcus: '🛡', Atlas: '🧭', Edward: '🪐', Cleo: '💵', Iris: '⭐',
  Larry: '🤝', Nina: '🌱', Nathan: '📊', Hugo: '🔧', Owen: '🔬',
  Gerda: '👤', Jose: '🧑‍💻', Registry: '🗂',
}

const TAG_CLASS: Record<string, string> = {
  'agent-build': 'bg-violet-100 text-violet-800',
  'EPL': 'bg-blue-100 text-blue-800',
  'landlord': 'bg-indigo-100 text-indigo-800',
  'data': 'bg-cyan-100 text-cyan-800',
  'MC': 'bg-emerald-100 text-emerald-800',
  'visual': 'bg-pink-100 text-pink-800',
  'agent': 'bg-purple-100 text-purple-800',
  'compliance': 'bg-rose-100 text-rose-800',
  'governance': 'bg-violet-100 text-violet-800',
  'onboarding': 'bg-pink-100 text-pink-800',
  'acquisition': 'bg-amber-100 text-amber-800',
  'hiring': 'bg-orange-100 text-orange-800',
  'QA': 'bg-yellow-100 text-yellow-800',
  'maintenance': 'bg-orange-100 text-orange-800',
}

function ageBadge(age: string) {
  const days = parseInt(age, 10) || 0
  if (days >= 7) return 'bg-rose-100 text-rose-800'
  if (days >= 3) return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-800'
}

export function EplProjectsPanel() {
  const router = useRouter()
  const [columns, setColumns] = useState<Column[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/epl/projects', { cache: 'no-store' }).then(r => r.json())
    setColumns(data.columns)
  }, [])

  useEffect(() => { load() }, [load])

  if (!columns) return <div className="p-8 text-sm text-slate-500">Loading projects…</div>

  const total = columns.reduce((s, c) => s + c.cards.length, 0)

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">📋 Projects</h1>
        <span className="text-slate-500">{total} cards across {columns.length} columns · Asana replacement (Wk4 sunset target)</span>
        <button onClick={load} className="ml-auto text-xs underline text-slate-500 hover:text-slate-700">refresh</button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        {columns.map(col => (
          <div key={col.id} className="bg-slate-50 rounded-2xl border border-slate-200 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-600 mb-2 font-medium">{col.label} <span className="text-slate-400">({col.cards.length})</span></div>
            <div className="space-y-2">
              {col.cards.map(card => (
                <button key={card.id} onClick={() => setExpandedId(expandedId === card.id ? null : card.id)} className="w-full text-left bg-white rounded-xl border border-slate-200 hover:border-slate-400 p-3 transition">
                  <div className="text-sm">{card.title}</div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs text-slate-500">{OWNER_EMOJI[card.owner] ?? '👤'} {card.owner}</span>
                    {card.tags.map(t => (
                      <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] ${TAG_CLASS[t] ?? 'bg-slate-100 text-slate-700'}`}>{t}</span>
                    ))}
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-xs ${ageBadge(card.age)}`}>{card.age}</span>
                  </div>
                  {expandedId === card.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-2">
                      <div>Card id: <code>{card.id}</code></div>
                      <div className="flex gap-2 flex-wrap">
                        {card.tags.includes('maintenance') && (
                          <button onClick={(e) => { e.stopPropagation(); router.push('/maintenance') }} className="px-2 py-1 rounded bg-orange-100 text-orange-800 text-xs">→ Maintenance</button>
                        )}
                        {card.tags.includes('landlord') && (
                          <button onClick={(e) => { e.stopPropagation(); router.push('/decisions') }} className="px-2 py-1 rounded bg-indigo-100 text-indigo-800 text-xs">→ Decisions</button>
                        )}
                        {card.tags.includes('agent') && (
                          <button onClick={(e) => { e.stopPropagation(); router.push('/agents-fleet') }} className="px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs">→ Agents</button>
                        )}
                      </div>
                    </div>
                  )}
                </button>
              ))}
              {col.cards.length === 0 && <div className="text-xs text-slate-400 italic">empty</div>}
            </div>
          </div>
        ))}
      </div>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/projects</code> · drag-drop persistence and per-card drawer wired when MC tasks table consolidated (Wk2-3)
      </footer>
    </div>
  )
}
