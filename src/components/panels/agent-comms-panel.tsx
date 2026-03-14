'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useMissionControl, type LogEntry, type Session } from '@/store'

import type { AggregateEvent } from '@/app/api/sessions/transcript/aggregate/route'

const COORDINATOR_AGENT = (process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').toLowerCase()

// ── Feed categories (mirrors OpenClaw TUI FeedCategory) ──

type FeedCategory = 'chat' | 'tools' | 'trace' | 'system' | 'safety'
type FeedFilter = 'all' | FeedCategory

interface FeedEvent {
  id: string
  ts: number
  category: FeedCategory
  source: string
  message: string
  level?: 'info' | 'warn' | 'error' | 'debug'
  data?: any
}

// Agent identity: color + emoji (matches openclaw.json)
const AGENT_IDENTITY: Record<string, { color: string; emoji: string; label: string }> = {
  [COORDINATOR_AGENT]: { color: '#a78bfa', emoji: '🧭', label: 'Coordinator' },
  builder:        { color: '#60a5fa', emoji: '🛠️', label: 'Builder' },
  research:       { color: '#4ade80', emoji: '🔬', label: 'Research' },
  content:        { color: '#818cf8', emoji: '✏️', label: 'Content' },
  ops:            { color: '#fb923c', emoji: '⚡', label: 'Ops' },
  quant:          { color: '#facc15', emoji: '📈', label: 'Quant' },
  aegis:          { color: '#f87171', emoji: '🧪', label: 'Aegis' },
  reviewer:       { color: '#2dd4bf', emoji: '🧪', label: 'Reviewer' },
  design:         { color: '#f472b6', emoji: '🎨', label: 'Design' },
  seo:            { color: '#22d3ee', emoji: '🔎', label: 'SEO' },
  security:       { color: '#fb7185', emoji: '🛡️', label: 'Security' },
  ai:             { color: '#8b5cf6', emoji: '🤖', label: 'AI' },
  'frontend-dev': { color: '#38bdf8', emoji: '🧩', label: 'Frontend Dev' },
  'backend-dev':  { color: '#34d399', emoji: '⚙️', label: 'Backend Dev' },
  'solana-dev':   { color: '#fbbf24', emoji: '🦀', label: 'Solana Dev' },
  gateway:        { color: '#94a3b8', emoji: '🌐', label: 'Gateway' },
  system:         { color: '#64748b', emoji: '⚙️', label: 'System' },
  websocket:      { color: '#a78bfa', emoji: '🔌', label: 'WebSocket' },
}

function getIdentity(name: string) {
  return AGENT_IDENTITY[name.toLowerCase()] || {
    color: '#9ca3af',
    emoji: name.charAt(0).toUpperCase(),
    label: name.charAt(0).toUpperCase() + name.slice(1),
  }
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const CATEGORY_META: Record<FeedCategory, { label: string; color: string }> = {
  chat:   { label: 'chat',   color: '#a78bfa' },
  tools:  { label: 'tools',  color: '#22d3ee' },
  trace:  { label: 'trace',  color: '#94a3b8' },
  system: { label: 'system', color: '#64748b' },
  safety: { label: 'safety', color: '#f87171' },
}

const FILTER_OPTIONS: { value: FeedFilter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'chat',   label: 'Chat' },
  { value: 'tools',  label: 'Tools' },
  { value: 'trace',  label: 'Trace' },
  { value: 'system', label: 'System' },
  { value: 'safety', label: 'Safety' },
]

// ── Map store data into unified FeedEvents ──

function logsToFeed(logs: LogEntry[]): FeedEvent[] {
  return logs.map(log => {
    let category: FeedCategory = 'trace'
    const src = (log.source || '').toLowerCase()
    const msg = (log.message || '').toLowerCase()

    if (src === 'gateway' || src === 'websocket') {
      if (msg.includes('tool') || msg.includes('spawn')) category = 'tools'
      else if (log.level === 'error' || msg.includes('security') || msg.includes('blocked')) category = 'safety'
      else category = 'trace'
    } else if (msg.includes('safety') || msg.includes('blocked') || msg.includes('injection')) {
      category = 'safety'
    } else if (msg.includes('tool')) {
      category = 'tools'
    }

    return {
      id: log.id,
      ts: log.timestamp,
      category,
      source: log.source || 'system',
      message: log.message,
      level: log.level,
      data: log.data,
    }
  })
}

interface CommsMessage {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string
  content: string
  message_type: string
  metadata: any
  created_at: number
}

interface CommsData {
  messages: CommsMessage[]
  total: number
  graph: {
    edges: { from_agent: string; to_agent: string; message_count: number; last_message_at: number }[]
    agentStats: { agent: string; sent: number; received: number }[]
  }
  source?: { mode: 'seeded' | 'live' | 'mixed' | 'empty'; seededCount: number; liveCount: number }
}

function commsToFeed(messages: CommsMessage[]): FeedEvent[] {
  return messages.map(msg => {
    const isToolCall = msg.message_type === 'tool_call' || Boolean(msg.metadata?.toolName)
    const toId = getIdentity(msg.to_agent)
    return {
      id: `comms-${msg.id}`,
      ts: msg.created_at * 1000,
      category: isToolCall ? 'tools' : 'chat',
      source: msg.from_agent,
      message: isToolCall
        ? `tool: ${msg.metadata?.toolName || msg.content}`
        : `@${toId.label} ${msg.content}`,
      data: msg.metadata,
    }
  })
}

function transcriptToFeed(events: AggregateEvent[]): FeedEvent[] {
  return events.map(e => {
    let category: FeedCategory = 'chat'
    if (e.type === 'tool_use' || e.type === 'tool_result') category = 'tools'
    else if (e.type === 'thinking') category = 'trace'
    else if (e.role === 'system') category = 'system'

    return {
      id: e.id,
      ts: e.ts,
      category,
      source: e.agentName,
      message: e.type === 'tool_use' ? `tool: ${e.content}`
        : e.type === 'tool_result' ? `result: ${e.content}`
        : e.type === 'thinking' ? `[thinking] ${e.content}`
        : e.content,
      data: e.metadata,
    }
  })
}

interface ActivityRecord {
  id: number
  type: string
  actor: string
  description: string
  data: any
  created_at: number
}

function activitiesToFeed(activities: ActivityRecord[]): FeedEvent[] {
  return activities.map(a => ({
    id: `activity-${a.id}`,
    ts: a.created_at * 1000,
    category: 'system' as FeedCategory,
    source: a.actor || 'system',
    message: a.description || a.type,
    level: 'info' as const,
    data: a.data,
  }))
}

// ── Main component ──

interface Target {
  type: 'agent' | 'session'
  name: string
  sessionKey?: string
}

export function AgentCommsPanel() {
  const t = useTranslations('agentComms')
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [commsData, setCommsData] = useState<CommsData | null>(null)
  const [transcriptData, setTranscriptData] = useState<AggregateEvent[]>([])
  const [transcriptSessionCount, setTranscriptSessionCount] = useState(0)
  const [activityEvents, setActivityEvents] = useState<ActivityRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const feedEndRef = useRef<HTMLDivElement>(null)
  const feedContainerRef = useRef<HTMLDivElement>(null)

  const {
    logs,
    sessions,
    connection,
    currentUser,
  } = useMissionControl()

  // Fetch DB-backed comms messages
  const fetchComms = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/comms?limit=200')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setCommsData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useSmartPoll(fetchComms, 15000)

  // Fetch aggregated transcript events from all gateway sessions
  const fetchTranscripts = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/transcript/aggregate?limit=200')
      if (!res.ok) return
      const json = await res.json()
      setTranscriptData(json.events || [])
      setTranscriptSessionCount(json.sessionCount || 0)
    } catch {
      // Silent — transcript is supplementary data
    }
  }, [])

  useSmartPoll(fetchTranscripts, 20000)

  // Fetch memory/agent activity events
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/activities?type=agent_memory_updated,agent_memory_cleared,memory_file_saved,memory_file_created,memory_file_deleted&limit=50')
      if (!res.ok) return
      const json = await res.json()
      setActivityEvents(json.activities || [])
    } catch {
      // Silent — activities are supplementary
    }
  }, [])

  useSmartPoll(fetchActivities, 30000)

  // Merge all sources into a single chronological feed
  const feedEvents = useMemo(() => {
    const fromLogs = logsToFeed(logs)
    const fromComms = commsToFeed(commsData?.messages || [])
    const fromTranscripts = transcriptToFeed(transcriptData)
    const fromActivities = activitiesToFeed(activityEvents)
    const merged = [...fromLogs, ...fromComms, ...fromTranscripts, ...fromActivities]
    // Deduplicate by id
    const seen = new Set<string>()
    const deduped = merged.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true })
    deduped.sort((a, b) => a.ts - b.ts)
    return deduped
  }, [logs, commsData?.messages, transcriptData, activityEvents])

  const filteredFeed = useMemo(() => {
    if (filter === 'all') return feedEvents
    return feedEvents.filter(e => e.category === filter)
  }, [feedEvents, filter])

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && feedContainerRef.current) {
      feedContainerRef.current.scrollTo({ top: feedContainerRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [filteredFeed.length, autoScroll])

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = useCallback(() => {
    const el = feedContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(atBottom)
  }, [])

  // Send message to selected target (or coordinator fallback)
  async function sendMessage() {
    const content = draft.trim()
    if (!content || sending) return

    const toAgent = target?.name || COORDINATOR_AGENT
    const from = currentUser?.username || currentUser?.display_name || 'operator'
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: toAgent,
          content,
          message_type: 'text',
          conversation_id: target ? `agent_${toAgent}` : `coord:${from}:${COORDINATOR_AGENT}`,
          forward: true,
          ...(target?.sessionKey ? { sessionKey: target.sessionKey } : {}),
          metadata: target ? undefined : { channel: 'coordinator-inbox' },
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 422 && payload?.injection) {
          const rules = payload.injection.map((i: any) => i.description || i.rule).join('; ')
          throw new Error(`Message blocked: content triggered safety filter (${rules})`)
        }
        if (res.status === 403) {
          throw new Error('You need operator access to send messages')
        }
        throw new Error(payload?.error || 'Failed to send')
      }

      if (payload?.forward?.attempted && !payload?.forward?.delivered) {
        const reason = payload?.forward?.reason || 'unknown'
        setSendError(`Sent, but not delivered to a live session (${reason}).`)
      }

      setDraft('')
      await fetchComms()
    } catch (err) {
      setSendError((err as Error).message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const sourceMode = commsData?.source?.mode || 'empty'
  const agents = commsData?.graph.agentStats.map(s => s.agent) || []

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { chat: 0, tools: 0, trace: 0, system: 0, safety: 0 }
    for (const e of feedEvents) counts[e.category] = (counts[e.category] || 0) + 1
    return counts
  }, [feedEvents])

  if (loading && !commsData && logs.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm">{t('connecting')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">📡</span>
            <h2 className="text-sm font-semibold text-foreground"># agent-feed</h2>
          </div>
          <span className="text-xs text-muted-foreground/60">
            {t('eventsCount', { count: filteredFeed.length })}
          </span>
          {/* Connection indicator */}
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              connection.isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : connection.sseConnected
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                  : 'bg-muted text-muted-foreground border-border/40'
            }`}
          >
            {connection.isConnected ? t('connectionGateway') : connection.sseConnected ? t('connectionSse') : t('connectionPolling')}
          </span>
          {sourceMode !== 'empty' && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                sourceMode === 'live'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : sourceMode === 'mixed'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
              }`}
            >
              {sourceMode === 'live' ? t('sourceLive') : sourceMode === 'mixed' ? t('sourceMixed') : t('sourceSeeded')}
            </span>
          )}
        </div>
      </div>

      {/* Filter bar — matches TUI FeedFilter */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border/30 flex-shrink-0 overflow-x-auto">
        {FILTER_OPTIONS.map(opt => (
          <Button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            variant="ghost"
            size="xs"
            className={`text-[11px] rounded-full ${
              filter === opt.value
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-surface-1'
            }`}
          >
            {opt.label}
            {opt.value !== 'all' && categoryCounts[opt.value] > 0 && (
              <span className="ml-1 text-[9px] opacity-60">{categoryCounts[opt.value]}</span>
            )}
          </Button>
        ))}

        {/* Session count */}
        {(sessions.length > 0 || transcriptSessionCount > 0) && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t('sessions', { active: sessions.filter(s => s.active).length, total: transcriptSessionCount || sessions.length })}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Live sessions strip */}
      {sessions.length > 0 && (
        <div className="px-4 py-2 border-b border-border/20 flex-shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto">
            {sessions.map(s => {
              const agentName = s.key.split(':')[1] || s.kind
              const isSelected = target?.type === 'session' && target.sessionKey === s.key
              return (
                <SessionChip
                  key={s.id}
                  session={s}
                  selected={isSelected}
                  onClick={() => {
                    if (isSelected) setTarget(null)
                    else setTarget({ type: 'session', name: agentName, sessionKey: s.key })
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Feed stream */}
      <div
        ref={feedContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 max-h-[500px]"
      >
        {filteredFeed.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="px-2 md:px-4 py-2 space-y-px font-mono text-[12px] leading-[1.6]">
            {filteredFeed.map(event => (
              <FeedLine key={event.id} event={event} />
            ))}
          </div>
        )}
        <div ref={feedEndRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredFeed.length > 0 && (
        <div className="flex justify-center py-1 border-t border-border/20">
          <Button
            onClick={() => {
              setAutoScroll(true)
              feedContainerRef.current?.scrollTo({ top: feedContainerRef.current.scrollHeight, behavior: 'smooth' })
            }}
            variant="ghost"
            size="xs"
            className="text-[10px] text-muted-foreground/60"
          >
            {t('scrollToLatest')}
          </Button>
        </div>
      )}

      {/* Online agents bar */}
      {agents.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-t border-border/30 flex-shrink-0 overflow-x-auto">
          {agents.map(a => {
            const id = getIdentity(a)
            const isSelected = target?.type === 'agent' && target.name === a
            return (
              <button
                type="button"
                key={a}
                onClick={() => {
                  if (isSelected) setTarget(null)
                  else setTarget({ type: 'agent', name: a })
                }}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border cursor-pointer transition-all ${
                  isSelected
                    ? 'ring-1 ring-primary bg-primary/10 border-primary/40 text-primary'
                    : 'bg-surface-1 border-border/50 text-muted-foreground/70 hover:border-border hover:text-muted-foreground'
                }`}
              >
                <span>{id.emoji}</span>
                <span>{id.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border/40 p-3 md:p-4 bg-surface-1/60 flex-shrink-0">
        {target && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60">{t('toLabel')}</span>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
            >
              <span>{getIdentity(target.name).emoji}</span>
              <span>{getIdentity(target.name).label}</span>
              <span className="ml-0.5 opacity-60">x</span>
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={target ? t('composerPlaceholderTarget', { name: getIdentity(target.name).label }) : t('composerPlaceholderBroadcast')}
            className="flex-1 resize-none bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            rows={2}
          />
          <Button
            onClick={sendMessage}
            disabled={sending || !draft.trim()}
            size="sm"
            className="h-9"
          >
            {sending ? '...' : t('send')}
          </Button>
        </div>
        {sendError && (
          <div className="mt-2 text-[11px] text-red-400">{sendError}</div>
        )}
      </div>
    </div>
  )
}

// ── Feed line (single event row — TUI-style) ──

function FeedLine({ event }: { event: FeedEvent }) {
  const cat = CATEGORY_META[event.category]
  const identity = getIdentity(event.source)

  const levelColor = event.level === 'error' ? 'text-red-400'
    : event.level === 'warn' ? 'text-amber-400'
    : ''

  return (
    <div className={`group flex items-start gap-2 px-2 py-0.5 rounded hover:bg-surface-1/50 transition-colors ${levelColor}`}>
      {/* Timestamp */}
      <span className="text-[10px] text-muted-foreground/40 tabular-nums flex-shrink-0 pt-[2px]">
        {formatTs(event.ts)}
      </span>

      {/* Category tag */}
      <span
        className="text-[9px] px-1.5 py-px rounded-full flex-shrink-0 mt-[2px]"
        style={{ backgroundColor: cat.color + '18', color: cat.color }}
      >
        {cat.label}
      </span>

      {/* Source */}
      <span
        className="text-[11px] font-semibold flex-shrink-0"
        style={{ color: identity.color }}
      >
        {identity.label}
      </span>

      {/* Message */}
      <span className="text-[12px] text-foreground/80 break-words min-w-0">
        {event.message}
      </span>
    </div>
  )
}

// ── Session chip (live gateway session) ──

function SessionChip({ session, selected, onClick }: { session: Session; selected?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] border transition-all cursor-pointer ${
        selected
          ? 'ring-1 ring-primary bg-primary/10 border-primary/40 text-primary'
          : session.active
            ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300 hover:border-emerald-500/50'
            : 'bg-surface-1 border-border/50 text-muted-foreground/60 hover:border-border'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${session.active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
      <span className="font-medium">{session.kind}</span>
      <span className="text-muted-foreground/40">{session.model}</span>
      <span className="text-muted-foreground/30">{session.age}</span>
      {session.tokens && (
        <span className="text-muted-foreground/30">{session.tokens} tok</span>
      )}
    </button>
  )
}

// ── Empty state ──

function EmptyState({ filter }: { filter: FeedFilter }) {
  const t = useTranslations('agentComms')
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-3">📡</div>
      <p className="text-sm font-medium text-muted-foreground">
        {filter === 'all' ? t('noFeedEvents') : t('noFilterEvents', { filter })}
      </p>
      <p className="text-xs text-muted-foreground/50 mt-1 max-w-[320px]">
        {filter === 'all'
          ? t('noFeedEventsHint')
          : t('noFilterEventsHint', { filter })}
      </p>
    </div>
  )
}
