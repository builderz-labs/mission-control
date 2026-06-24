'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const AGENTS = [
  { id: 'aria',     emoji: '💷', label: 'Aria',     desc: 'Pricing' },
  { id: 'victoria', emoji: '📈', label: 'Victoria', desc: 'Revenue' },
  { id: 'leo',      emoji: '📊', label: 'Leo',      desc: 'Marketing' },
  { id: 'james',    emoji: '💰', label: 'James',    desc: 'Finance' },
  { id: 'iris',     emoji: '✨', label: 'Iris',     desc: 'Guest Experience' },
  { id: 'edward',   emoji: '🛠️', label: 'Edward',   desc: 'Architecture' },
  { id: 'cleo',     emoji: '💵', label: 'Cleo',     desc: 'Cash Flow' },
  { id: 'larry',    emoji: '🤝', label: 'Larry',    desc: 'Landlord Relations' },
  { id: 'marcus',   emoji: '📋', label: 'Marcus',   desc: 'Compliance' },
  { id: 'nina',     emoji: '🚀', label: 'Nina',     desc: 'Onboarding' },
  { id: 'sofia',    emoji: '📧', label: 'Sofia',    desc: 'Email PA' },
  { id: 'atlas',    emoji: '🧭', label: 'Atlas',    desc: 'Chief of Staff' },
] as const

type AgentId = (typeof AGENTS)[number]['id']

const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a])) as Record<string, { id: string; emoji: string; label: string; desc: string }>

const MESSAGE_STYLES: Record<string, { bg: string; badge: string }> = {
  atlas:           { bg: 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800', badge: '🧭 Atlas — synthesis' },
  chatgpt:         { bg: 'bg-orange-50 border border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',    badge: '🟢 ChatGPT — review' },
  gemini:          { bg: 'bg-purple-50 border border-purple-200 dark:bg-purple-950/30 dark:border-purple-800',    badge: '✦ Gemini — review' },
  'gemini-search': { bg: 'bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',            badge: '🔍 Gemini Search — market research' },
}

function getMessageStyle(author: string) {
  if (MESSAGE_STYLES[author]) return MESSAGE_STYLES[author]
  const agent = AGENT_MAP[author]
  return { bg: 'bg-muted/40 border border-border', badge: agent ? `${agent.emoji} ${agent.label}` : `🤖 ${author}` }
}

interface Room { id: number; topic: string; participants: string[]; kind: string; status: string; created_by?: string; created_at: string; closed_at?: string }
interface RoomMessage { id: number; room_id: number; author: string; author_kind: string; turn: number; body: string; created_at: string }

export function CouncilPanel() {
  const [topic, setTopic] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set(['aria', 'victoria', 'leo', 'james', 'iris', 'edward']))
  const [search, setSearch] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [openRoomId, setOpenRoomId] = useState<number | null>(null)
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadRooms = useCallback(async () => {
    try {
      const resp = await fetch('/api/council/rooms', { cache: 'no-store' })
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); setRoomsError((d as { error?: string }).error || `Error ${resp.status}`); return }
      const data = await resp.json()
      setRooms((data.rooms || []).filter((r: Room) => r.kind === 'council' || r.kind === 'brainstorm'))
      setRoomsError(null)
    } catch { setRoomsError('Could not reach Atlas') }
  }, [])

  useEffect(() => { loadRooms() }, [loadRooms])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!activeRoomId) return
    const poll = async () => {
      try {
        const resp = await fetch(`/api/council/rooms?id=${activeRoomId}`, { cache: 'no-store' })
        if (!resp.ok) return
        const data = await resp.json()
        setRoomMessages(data.messages || [])
        if ((data.room as Room)?.status === 'closed') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setActiveRoomId(null)
          loadRooms()
        }
      } catch { /* ignore */ }
    }
    poll()
    pollRef.current = setInterval(poll, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeRoomId, loadRooms])

  const openRoom = useCallback(async (room: Room) => {
    if (openRoomId === room.id) { setOpenRoomId(null); setRoomMessages([]); setActiveRoomId(null); return }
    setOpenRoomId(room.id); setLoadingMessages(true); setRoomMessages([])
    try {
      const resp = await fetch(`/api/council/rooms?id=${room.id}`, { cache: 'no-store' })
      if (resp.ok) { const data = await resp.json(); setRoomMessages(data.messages || []) }
    } finally { setLoadingMessages(false) }
    if (room.status !== 'closed') setActiveRoomId(room.id)
  }, [openRoomId])

  const startCouncil = useCallback(async () => {
    if (!topic.trim() || selectedAgents.size === 0) return
    setStarting(true); setStartError(null)
    try {
      const resp = await fetch('/api/council/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: Array.from(selectedAgents), topic: topic.trim(), search }),
      })
      const data = await resp.json()
      if (!resp.ok) { setStartError((data as { error?: string }).error || `Error ${resp.status}`); return }
      const newRoom = data as { room_id: number; participants: string[]; topic: string }
      setTopic('')
      setOpenRoomId(newRoom.room_id); setActiveRoomId(newRoom.room_id); setRoomMessages([])
      setRooms(prev => [{ id: newRoom.room_id, topic: newRoom.topic, participants: newRoom.participants, kind: 'council', status: 'open', created_at: new Date().toISOString() }, ...prev])
    } catch { setStartError('Failed to start council — is Atlas running?') }
    finally { setStarting(false) }
  }, [topic, selectedAgents, search])

  const toggleAgent = useCallback((id: AgentId) => {
    setSelectedAgents(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  return (
    <div className="flex flex-col gap-6 p-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">💬 Agent Council</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask a question — agents research it in parallel using Google Search, then Atlas synthesises and ChatGPT stress-tests the plan.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Topic / question</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            rows={3}
            placeholder="e.g. What should we build next to increase direct bookings? Where are we leaving money on the table in pricing?"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startCouncil() }}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agents to include</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {AGENTS.map(agent => (
              <button key={agent.id} onClick={() => toggleAgent(agent.id)} title={agent.desc}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedAgents.has(agent.id) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                }`}>
                <span>{agent.emoji}</span><span>{agent.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{selectedAgents.size} agent{selectedAgents.size !== 1 ? 's' : ''} selected</p>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={search} onChange={e => setSearch(e.target.checked)} className="rounded" />
            <span>Google Search context <span className="text-muted-foreground">(Gemini grounding)</span></span>
          </label>
          <button onClick={startCouncil} disabled={starting || !topic.trim() || selectedAgents.size === 0}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors">
            {starting ? 'Starting…' : '▶ Start Council'}
          </button>
        </div>
        {startError && <p className="text-xs text-destructive">{startError}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past councils</h2>
          <button onClick={loadRooms} className="text-xs text-muted-foreground hover:text-foreground transition-colors">↻ Refresh</button>
        </div>
        {roomsError && <p className="text-xs text-destructive mb-3">Could not load rooms: {roomsError}</p>}
        {rooms.length === 0 && !roomsError && <p className="text-sm text-muted-foreground">No council rooms yet — start one above.</p>}
        <div className="flex flex-col gap-3">
          {rooms.map(room => (
            <div key={room.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button onClick={() => openRoom(room)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                <span className="text-lg mt-0.5">💬</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm leading-snug">{room.topic}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{(room.participants || []).map(p => { const a = AGENT_MAP[p]; return a ? `${a.emoji} ${a.label}` : p }).join(' · ')}</span>
                    <span>#{room.id}</span>
                    <span className={room.status === 'closed' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400 font-medium'}>{room.status === 'closed' ? 'done' : '⏳ running…'}</span>
                    <span>{new Date(room.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <span className="text-muted-foreground text-xs mt-0.5">{openRoomId === room.id ? '▲' : '▼'}</span>
              </button>
              {openRoomId === room.id && (
                <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
                  {loadingMessages && <p className="text-xs text-muted-foreground">Loading transcript…</p>}
                  {!loadingMessages && roomMessages.length === 0 && (
                    <p className="text-xs text-muted-foreground">{room.status !== 'closed' ? '⏳ Council is running — agents are thinking…' : 'No messages recorded.'}</p>
                  )}
                  {roomMessages.map(msg => {
                    const style = getMessageStyle(msg.author)
                    return (
                      <div key={msg.id} className={`rounded-lg p-3 ${style.bg}`}>
                        <div className="text-xs font-semibold mb-1.5 opacity-70">{style.badge}</div>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.body}</div>
                      </div>
                    )
                  })}
                  {activeRoomId === room.id && room.status !== 'closed' && (
                    <p className="text-xs text-muted-foreground text-center animate-pulse">⏳ Polling for updates every 4 s…</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
