'use client'

/**
 * EPL Projects Panel — v0.2 real React.
 *
 * 6-col Kanban that replaces Asana for the agent fleet (Wk4 target).
 * - Cards drag-droppable across columns (local state; server persistence TODO
 *   when the MC tasks table is wired — that's the data-wiring pass).
 * - Click card → expand inline drawer with cross-links + Ask Claude / Ask ChatGPT.
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

/** Build a contextual prompt from a card for an assistant hand-off. */
function cardPrompt(card: Card, colLabel: string) {
  return [
    `Project ticket from Mission Control (EPL agent fleet):`,
    ``,
    `• Title: ${card.title}`,
    `• Owner: ${card.owner}`,
    `• Status column: ${colLabel}`,
    `• Tags: ${card.tags.join(', ') || '—'}`,
    `• Card id: ${card.id}`,
    ``,
    `Help me move this forward — give me the concrete next steps and anything I should watch out for.`,
  ].join('\n')
}

export function EplProjectsPanel() {
  const router = useRouter()
  const [columns, setColumns] = useState<Column[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // drag-drop (local only; persistence handled by the data-wiring pass)
  const [drag, setDrag] = useState<{ cardId: string; fromCol: string } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/epl/projects', { cache: 'no-store' }).then(r => r.json())
    setColumns(data.columns)
  }, [])

  useEffect(() => { load() }, [load])

  const moveCard = useCallback((toCol: string) => {
    setColumns(prev => {
      if (!prev || !drag) return prev
      const { cardId, fromCol } = drag
      if (fromCol === toCol) return prev
      const moved = prev.find(c => c.id === fromCol)?.cards.find(c => c.id === cardId)
      if (!moved) return prev
      return prev.map(c => {
        if (c.id === fromCol) return { ...c, cards: c.cards.filter(x => x.id !== cardId) }
        if (c.id === toCol) return { ...c, cards: [...c.cards, moved] }
        return c
      })
    })
    setDrag(null)
    setOverCol(null)
  }, [drag])

  const ask = useCallback((card: Card, colLabel: string, target: 'claude' | 'chatgpt') => {
    const q = encodeURIComponent(cardPrompt(card, colLabel))
    const url = target === 'claude'
      ? `https://claude.ai/new?q=${q}`
      : `https://chatgpt.com/?q=${q}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

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
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); if (overCol !== col.id) setOverCol(col.id) }}
            onDragLeave={() => setOverCol(c => (c === col.id ? null : c))}
            onDrop={(e) => { e.preventDefault(); moveCard(col.id) }}
            className={`rounded-2xl border p-3 transition-colors ${overCol === col.id ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'}`}
          >
            <div className="text-xs uppercase tracking-wide text-slate-600 mb-2 font-medium">{col.label} <span className="text-slate-400">({col.cards.length})</span></div>
            <div className="space-y-2 min-h-[2rem]">
              {col.cards.map(card => (
                <div
                  key={card.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => { setDrag({ cardId: card.id, fromCol: col.id }); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { setDrag(null); setOverCol(null) }}
                  onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === card.id ? null : card.id) } }}
                  className={`w-full text-left bg-white rounded-xl border border-slate-200 hover:border-slate-400 p-3 transition cursor-grab active:cursor-grabbing ${drag?.cardId === card.id ? 'opacity-50' : ''}`}
                >
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
                        <button onClick={(e) => { e.stopPropagation(); ask(card, col.label, 'claude') }} className="px-2 py-1 rounded bg-slate-900 text-white text-xs hover:bg-slate-700">✦ Ask Claude</button>
                        <button onClick={(e) => { e.stopPropagation(); ask(card, col.label, 'chatgpt') }} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500">⌁ Ask ChatGPT</button>
                      </div>
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
                </div>
              ))}
              {col.cards.length === 0 && <div className="text-xs text-slate-400 italic">empty</div>}
            </div>
          </div>
        ))}
      </div>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/projects</code> · drag-drop is local — server persistence wired when MC tasks table is consolidated (data-wiring pass)
      </footer>
    </div>
  )
}
