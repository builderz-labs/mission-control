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

// ─── Task detail types ───────────────────────────────────────────────────
type TaskFull = {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string | null
  due_date: number | null
  parent_task_id: number | null
  tags: string[]
}

type CommentRow = {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
}

type SubtaskRow = {
  id: number
  title: string
  status: string
  assigned_to: string | null
}

type AttachmentRow = {
  id: number
  type: string
  url: string
  label: string | null
  added_by: string
  added_at: number
}

const ATTACHMENT_ICON: Record<string, string> = {
  drive_link: '📂', sheet_link: '📊', boom_link: '🛏', slack_link: '💬',
  asana_link: '✅', github_link: '🐙', external_url: '🔗', file_upload: '📎',
  photo: '🖼', pdf: '📄',
}

function detectAttachmentType(url: string): string {
  if (/docs\.google\.com\/document/.test(url)) return 'drive_link'
  if (/docs\.google\.com\/spreadsheets/.test(url)) return 'sheet_link'
  if (/drive\.google\.com/.test(url)) return 'drive_link'
  if (/app\.boomnow\.com|boomnowconnect/.test(url)) return 'boom_link'
  if (/slack\.com/.test(url)) return 'slack_link'
  if (/app\.asana\.com/.test(url)) return 'asana_link'
  if (/github\.com/.test(url)) return 'github_link'
  if (/\.pdf($|\?)/i.test(url)) return 'pdf'
  if (/\.(png|jpg|jpeg|gif|webp)($|\?)/i.test(url)) return 'photo'
  return 'external_url'
}

// Reverse of statusToColumn in /api/epl/projects/route.ts.
// When a card is dropped into a column, this is the MC status we persist
// via PUT /api/tasks/[id]. Done column maps to 'done'; the "this week"
// filter is server-side (completed_at within 7d).
const COLUMN_TO_STATUS: Record<string, string> = {
  inbox: 'inbox',
  up_next: 'assigned',
  in_progress: 'in_progress',
  waiting: 'awaiting_owner',
  review: 'review',
  done_this_week: 'done',
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

  const moveCard = useCallback(async (toCol: string) => {
    if (!drag) return
    const { cardId, fromCol } = drag
    setDrag(null)
    setOverCol(null)
    if (fromCol === toCol) return

    // Optimistic UI: move locally first so the drop feels instant.
    setColumns(prev => {
      if (!prev) return prev
      const moved = prev.find(c => c.id === fromCol)?.cards.find(c => c.id === cardId)
      if (!moved) return prev
      return prev.map(c => {
        if (c.id === fromCol) return { ...c, cards: c.cards.filter(x => x.id !== cardId) }
        if (c.id === toCol) return { ...c, cards: [...c.cards, moved] }
        return c
      })
    })

    // Persist via PUT /api/tasks/[id]. cardId from /api/epl/projects is tasks.id as string.
    const newStatus = COLUMN_TO_STATUS[toCol]
    if (!newStatus) return
    try {
      const resp = await fetch(`/api/tasks/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!resp.ok) {
        // Server rejected — reload from canonical state.
        await load()
      }
    } catch {
      await load()
    }
  }, [drag, load])

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
                    <TaskDetail
                      cardId={card.id}
                      cardTitle={card.title}
                      cardOwner={card.owner}
                      colLabel={col.label}
                      onAsk={(t) => ask(card, col.label, t)}
                      onNav={(path) => router.push(path)}
                      cardTags={card.tags}
                    />
                  )}
                </div>
              ))}
              {col.cards.length === 0 && <div className="text-xs text-slate-400 italic">empty</div>}
            </div>
          </div>
        ))}
      </div>

      <footer className="text-xs text-slate-400 pt-4 border-t border-slate-100">
        Source: <code>/api/epl/projects</code> (real tasks DB) · drag-drop persists via <code>PUT /api/tasks/[id]</code> · click card for subtasks / comments / attachments
      </footer>
    </div>
  )
}

// ─── Task detail (Phase 2c) ──────────────────────────────────────────────
// Fetches subtasks, comments, attachments on expand. Supports adding each.
function TaskDetail({
  cardId, cardTitle, cardOwner, colLabel, cardTags, onAsk, onNav,
}: {
  cardId: string
  cardTitle: string
  cardOwner: string
  colLabel: string
  cardTags: string[]
  onAsk: (t: 'claude' | 'chatgpt') => void
  onNav: (path: string) => void
}) {
  const [task, setTask] = useState<TaskFull | null>(null)
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [newSubtask, setNewSubtask] = useState('')
  const [newAttachUrl, setNewAttachUrl] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, sRes, cRes, aRes] = await Promise.all([
        fetch(`/api/tasks/${cardId}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tasks?parent_task_id=${cardId}&limit=50`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tasks/${cardId}/comments`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tasks/${cardId}/attachments`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      setTask(tRes?.task ?? tRes ?? null)
      const subs = sRes?.tasks ?? []
      setSubtasks(subs.map((s: TaskFull) => ({
        id: s.id, title: s.title, status: s.status, assigned_to: s.assigned_to,
      })))
      // /api/tasks/[id]/comments returns nested thread; flatten top-level for now.
      const cflat: CommentRow[] = []
      const walk = (arr: { id: number; task_id?: number; author: string; content: string; created_at: number; replies?: unknown[] }[]) => {
        for (const c of arr || []) {
          cflat.push({ id: c.id, task_id: c.task_id ?? Number(cardId), author: c.author, content: c.content, created_at: c.created_at })
          if (Array.isArray(c.replies)) walk(c.replies as typeof arr)
        }
      }
      walk(cRes?.comments ?? [])
      setComments(cflat)
      setAttachments(aRes?.attachments ?? [])
    } finally {
      setLoading(false)
    }
  }, [cardId])

  useEffect(() => { loadAll() }, [loadAll])

  const addComment = async () => {
    const text = newComment.trim()
    if (!text) return
    setNewComment('')
    try {
      await fetch(`/api/tasks/${cardId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
    } finally { loadAll() }
  }

  const addSubtask = async () => {
    const title = newSubtask.trim()
    if (!title) return
    setNewSubtask('')
    try {
      await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, parent_task_id: Number(cardId), status: 'inbox' }),
      })
    } finally { loadAll() }
  }

  const toggleSubtask = async (sub: SubtaskRow) => {
    const newStatus = sub.status === 'done' ? 'inbox' : 'done'
    try {
      await fetch(`/api/tasks/${sub.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
    } finally { loadAll() }
  }

  const addAttachment = async () => {
    const url = newAttachUrl.trim()
    if (!url) return
    setNewAttachUrl('')
    try {
      await fetch(`/api/tasks/${cardId}/attachments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: detectAttachmentType(url) }),
      })
    } finally { loadAll() }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-700 space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Action bar */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => onAsk('claude')} className="px-2 py-1 rounded bg-slate-900 text-white text-xs hover:bg-slate-700">✦ Ask Claude</button>
        <button onClick={() => onAsk('chatgpt')} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500">⌁ Ask ChatGPT</button>
        {cardTags.includes('maintenance') && (
          <button onClick={() => onNav('/maintenance')} className="px-2 py-1 rounded bg-orange-100 text-orange-800 text-xs">→ Maintenance</button>
        )}
        {cardTags.includes('landlord') && (
          <button onClick={() => onNav('/decisions')} className="px-2 py-1 rounded bg-indigo-100 text-indigo-800 text-xs">→ Decisions</button>
        )}
        {cardTags.includes('agent') && (
          <button onClick={() => onNav('/agents-fleet')} className="px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs">→ Agents</button>
        )}
      </div>

      {loading && <div className="text-slate-400 italic">loading detail…</div>}

      {/* Description */}
      {task?.description && (
        <div className="bg-slate-50 rounded p-2 whitespace-pre-wrap text-slate-700">{task.description}</div>
      )}

      {/* Subtasks */}
      <div>
        <div className="font-medium text-slate-500 mb-1">Subtasks ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})</div>
        <ul className="space-y-1">
          {subtasks.map(s => (
            <li key={s.id} className="flex items-center gap-2">
              <input type="checkbox" checked={s.status === 'done'} onChange={() => toggleSubtask(s)} />
              <span className={s.status === 'done' ? 'line-through text-slate-400' : ''}>{s.title}</span>
              {s.assigned_to && <span className="text-[10px] text-slate-400">· {s.assigned_to}</span>}
            </li>
          ))}
        </ul>
        <div className="flex gap-1 mt-1">
          <input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addSubtask() }}
            placeholder="+ add subtask…"
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
          />
          <button onClick={addSubtask} className="px-2 py-1 rounded bg-slate-200 text-xs">add</button>
        </div>
      </div>

      {/* Attachments */}
      <div>
        <div className="font-medium text-slate-500 mb-1">Attachments ({attachments.length})</div>
        <ul className="space-y-1">
          {attachments.map(a => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {ATTACHMENT_ICON[a.type] ?? '🔗'} {a.label || a.url}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex gap-1 mt-1">
          <input
            value={newAttachUrl}
            onChange={(e) => setNewAttachUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAttachment() }}
            placeholder="+ paste URL (Drive / Sheet / BOOM / Slack / etc.)"
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
          />
          <button onClick={addAttachment} className="px-2 py-1 rounded bg-slate-200 text-xs">add</button>
        </div>
      </div>

      {/* Comments */}
      <div>
        <div className="font-medium text-slate-500 mb-1">Comments ({comments.length})</div>
        <ul className="space-y-1">
          {comments.map(c => (
            <li key={c.id} className="bg-slate-50 rounded p-2">
              <div className="text-[10px] text-slate-500">{c.author} · {new Date(c.created_at * 1000).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{c.content}</div>
            </li>
          ))}
        </ul>
        <div className="flex gap-1 mt-1">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addComment() }}
            placeholder="+ add comment…"
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
          />
          <button onClick={addComment} className="px-2 py-1 rounded bg-slate-200 text-xs">post</button>
        </div>
      </div>

      <div className="text-[10px] text-slate-400">card id: <code>{cardId}</code> · owner: {cardOwner} · column: {colLabel}</div>
    </div>
  )
}
