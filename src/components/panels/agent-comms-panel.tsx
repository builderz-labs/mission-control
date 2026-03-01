'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useMissionControl } from '@/store'

const COORDINATOR_AGENT = (process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').toLowerCase()

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

interface GraphEdge {
  from_agent: string
  to_agent: string
  message_count: number
  last_message_at: number
}

interface AgentStat {
  agent: string
  sent: number
  received: number
}

interface CommsData {
  messages: CommsMessage[]
  total: number
  graph: {
    edges: GraphEdge[]
    agentStats: AgentStat[]
  }
  source?: {
    mode: "seeded" | "live" | "mixed" | "empty"
    seededCount: number
    liveCount: number
  }
}

interface AgentOption {
  name: string
  role?: string
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
}

function getIdentity(name: string) {
  return AGENT_IDENTITY[name.toLowerCase()] || {
    color: '#9ca3af',
    emoji: name.charAt(0).toUpperCase(),
    label: name.charAt(0).toUpperCase() + name.slice(1),
  }
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function AgentCommsPanel() {
  const [data, setData] = useState<CommsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [view, setView] = useState<'chat' | 'graph'>('chat')
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([])
  const [fromAgent, setFromAgent] = useState('')
  const [toAgent, setToAgent] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [composerMode, setComposerMode] = useState<'coordinator' | 'agent'>('coordinator')
  const { currentUser } = useMissionControl()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchComms = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (filter !== 'all') params.set('agent', filter)
      const res = await fetch(`/api/agents/comms?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useSmartPoll(fetchComms, 15000)
  useSmartPoll(async () => {
    try {
      const res = await fetch('/api/agents?limit=200')
      if (!res.ok) return
      const json = await res.json()
      const rows = Array.isArray(json?.agents) ? json.agents : []
      const names = rows
        .map((a: any) => ({ name: String(a.name || ''), role: a.role ? String(a.role) : undefined }))
        .filter((a: AgentOption) => a.name.length > 0)
      setAgentOptions(names)
    } catch {
      // noop
    }
  }, 60000)

  const sourceMode = data?.source?.mode || "empty"
  const agents = data?.graph.agentStats.map(s => s.agent) || []
  const allAgents = Array.from(new Set([
    ...agentOptions.map(a => a.name),
    ...agents,
    COORDINATOR_AGENT,
  ])).sort()

  useEffect(() => {
    if (!fromAgent && allAgents.length > 0) {
      setFromAgent(allAgents[0])
    }
    if (!toAgent && allAgents.length > 1) {
      setToAgent(allAgents[1])
    }
  }, [allAgents, fromAgent, toAgent])

  async function sendComposedMessage() {
    const content = draft.trim()
    if (!content || sending) return

    const isCoordinator = composerMode === 'coordinator'
    const from = isCoordinator
      ? (currentUser?.username || currentUser?.display_name || 'operator')
      : fromAgent
    const to = isCoordinator ? COORDINATOR_AGENT : toAgent

    if (!from || !to || (!isCoordinator && from === to)) return

    setSending(true)
    setSendError(null)
    try {
      const conversation_id = isCoordinator
        ? `coord:${from}:${COORDINATOR_AGENT}`
        : `a2a:${from}:${to}`

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          content,
          message_type: 'text',
          conversation_id,
          forward: true,
          metadata: isCoordinator ? { channel: 'coordinator-inbox' } : undefined,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
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

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm">Loading agent comms...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">💬</span>
            <h2 className="text-sm font-semibold text-foreground"># agent-comms</h2>
          </div>
          <span className="text-xs text-muted-foreground/60">
            {data?.total || 0} messages
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              sourceMode === "live"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : sourceMode === "mixed"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : sourceMode === "seeded"
                    ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                    : "bg-muted text-muted-foreground border-border/40"
            }`}
            title={
              sourceMode === "live"
                ? "Only live agent communications"
                : sourceMode === "mixed"
                  ? "Contains both seeded and live communications"
                  : sourceMode === "seeded"
                    ? "Only seeded demo communications"
                    : "No communications yet"
            }
          >
            {sourceMode === "live" ? "Live" : sourceMode === "mixed" ? "Mixed" : sourceMode === "seeded" ? "Seeded" : "Empty"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-surface-1 rounded-lg p-0.5 border border-border/50">
            <button
              onClick={() => setView('chat')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-smooth ${
                view === 'chat' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setView('graph')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-smooth ${
                view === 'graph' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Graph
            </button>
          </div>

          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-surface-1 border border-border/50 rounded-lg px-2 py-1 text-[11px] text-foreground"
          >
            <option value="all">All</option>
            {agents.map(a => {
              const id = getIdentity(a)
              return <option key={a} value={a}>{id.emoji} {id.label}</option>
            })}
          </select>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {view === 'graph' ? (
          <div className="p-4">
            <CommGraph edges={data?.graph.edges || []} agentStats={data?.graph.agentStats || []} />
          </div>
        ) : (
          <ChatView messages={data?.messages || []} />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Online agents bar */}
      {agents.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-t border-border/30 flex-shrink-0 overflow-x-auto">
          {agents.map(a => {
            const id = getIdentity(a)
            return (
              <button
                key={a}
                onClick={() => setFilter(filter === a ? 'all' : a)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-smooth whitespace-nowrap ${
                  filter === a
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-surface-1'
                }`}
              >
                <span className="text-xs">{id.emoji}</span>
                <span>{id.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Interactive composer */}
      <div className="border-t border-border/40 p-3 md:p-4 bg-surface-1/60 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex bg-surface-1 rounded-lg p-0.5 border border-border/50">
            <button
              onClick={() => setComposerMode('coordinator')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-smooth ${
                composerMode === 'coordinator' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Coordinator
            </button>
            <button
              onClick={() => setComposerMode('agent')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-smooth ${
                composerMode === 'agent' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Agent↔Agent
            </button>
          </div>
        </div>

        {composerMode === 'agent' ? (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">Write as</span>
            <select
              value={fromAgent}
              onChange={(e) => setFromAgent(e.target.value)}
              className="bg-card border border-border/50 rounded-md px-2 py-1 text-xs text-foreground"
            >
              <option value="">from...</option>
              {allAgents.map(a => <option key={`from-${a}`} value={a}>{getIdentity(a).emoji} {getIdentity(a).label}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">to</span>
            <select
              value={toAgent}
              onChange={(e) => setToAgent(e.target.value)}
              className="bg-card border border-border/50 rounded-md px-2 py-1 text-xs text-foreground"
            >
              <option value="">to...</option>
              {allAgents.filter(a => a !== fromAgent).map(a => (
                <option key={`to-${a}`} value={a}>{getIdentity(a).emoji} {getIdentity(a).label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="mb-2 text-xs text-muted-foreground">
            You ({currentUser?.display_name || currentUser?.username || 'operator'}) → {getIdentity(COORDINATOR_AGENT).label}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendComposedMessage()
              }
            }}
            placeholder={composerMode === 'coordinator'
              ? 'Write to the coordinator. It will coordinate downstream agents...'
              : 'Type agent-to-agent message... (Enter to send, Shift+Enter newline)'}
            className="flex-1 resize-none bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            rows={2}
          />
          <button
            onClick={sendComposedMessage}
            disabled={
              sending ||
              !draft.trim() ||
              (composerMode === 'agent' && (!fromAgent || !toAgent || fromAgent === toAgent))
            }
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>

        {composerMode === 'coordinator' && (
          <div className="mt-2 text-[11px] text-muted-foreground/70">
            Coordinator messages are sent directly to the coordinator for orchestration.
          </div>
        )}

        {sendError && (
          <div className="mt-2 text-[11px] text-red-400">{sendError}</div>
        )}
      </div>
    </div>
  )
}

// ── Group Chat View ──

function ChatView({ messages }: { messages: CommsMessage[] }) {
  if (messages.length === 0) return <EmptyState />

  // Stable chronological order even if API results are mixed
  const sorted = [...messages].sort((a, b) =>
    a.created_at === b.created_at ? a.id - b.id : a.created_at - b.created_at
  )

  // Group by date, then detect consecutive same-sender
  const groups: { date: string; messages: CommsMessage[] }[] = []
  let currentDate = ''

  for (const msg of sorted) {
    const date = formatDate(msg.created_at)
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, messages: [] })
    }
    groups[groups.length - 1].messages.push(msg)
  }

  return (
    <div className="px-2 md:px-4 py-3 space-y-3">
      {groups.map(group => (
        <div key={group.date}>
          {/* Date divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1 bg-border/40" />
            <span className="text-[10px] font-medium text-muted-foreground/50 bg-background px-2">{group.date}</span>
            <div className="h-px flex-1 bg-border/40" />
          </div>

          {/* Messages */}
          <div className="space-y-0.5">
            {group.messages.map((msg, i) => {
              const prev = i > 0 ? group.messages[i - 1] : null
              const sameSender = prev?.from_agent === msg.from_agent
              const closeInTime = prev && (msg.created_at - prev.created_at) < 180 // 3 min
              const collapse = sameSender && closeInTime

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  collapsed={!!collapse}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function ChatMessage({ message, collapsed }: { message: CommsMessage; collapsed: boolean }) {
  const identity = getIdentity(message.from_agent)
  const toIdentity = getIdentity(message.to_agent)
  const isHandoff = message.message_type === 'handoff'

  // Inject @mention of target at start if it's a directed message
  const mentionPrefix = message.to_agent ? `@${message.to_agent}` : null

  return (
    <div className={`group flex gap-2.5 px-2 py-0.5 rounded-lg hover:bg-surface-1/50 transition-smooth ${collapsed ? '' : 'mt-3'}`}>
      {/* Avatar or spacer */}
      <div className="w-9 flex-shrink-0">
        {!collapsed && (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
            style={{ backgroundColor: identity.color + '20' }}
          >
            {identity.emoji}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!collapsed && (
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span
              className="text-[13px] font-semibold cursor-default"
              style={{ color: identity.color }}
            >
              {identity.label}
            </span>
            {isHandoff && (
              <span className="text-[9px] px-1.5 py-px rounded-full font-medium"
                style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}
              >
                handoff
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/40 tabular-nums">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        <div className="text-[13px] text-foreground/90 leading-[1.45] break-words">
          {mentionPrefix && (
            <span
              className="font-medium rounded px-0.5 cursor-default"
              style={{
                color: toIdentity.color,
                backgroundColor: toIdentity.color + '15',
              }}
            >
              @{toIdentity.label}
            </span>
          )}{' '}
          {message.content}
        </div>

        {/* Metadata (if any) */}
        {message.metadata && Object.keys(message.metadata).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(message.metadata).map(([k, v]) => (
              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 border border-border/50 text-muted-foreground/60">
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hover timestamp for collapsed messages */}
      {collapsed && (
        <span className="text-[10px] text-muted-foreground/0 group-hover:text-muted-foreground/40 tabular-nums self-center transition-smooth flex-shrink-0">
          {formatTime(message.created_at)}
        </span>
      )}
    </div>
  )
}

// ── Communication Graph View ──

function CommGraph({ edges, agentStats }: { edges: GraphEdge[]; agentStats: AgentStat[] }) {
  if (agentStats.length === 0) return <EmptyState />

  const maxMessages = Math.max(...agentStats.map(s => s.sent + s.received), 1)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {agentStats.map(stat => {
          const id = getIdentity(stat.agent)
          const total = stat.sent + stat.received
          const pct = Math.max((total / maxMessages) * 100, 8)

          return (
            <div key={stat.agent} className="rounded-lg p-3 space-y-2 bg-surface-1 border border-border/50">
              <div className="flex items-center gap-2">
                <span className="text-base">{id.emoji}</span>
                <span className="text-xs font-medium" style={{ color: id.color }}>{id.label}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
                <span>{stat.sent} sent</span>
                <span>{stat.received} recv</span>
              </div>
              <div className="h-1 bg-border/30 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: id.color }} />
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground/60 mb-2 uppercase tracking-wider">Channels</h3>
        <div className="space-y-1">
          {edges.map((edge, i) => {
            const from = getIdentity(edge.from_agent)
            const to = getIdentity(edge.to_agent)
            return (
              <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg hover:bg-surface-1 transition-smooth">
                <span className="text-sm">{from.emoji}</span>
                <span className="text-xs font-medium" style={{ color: from.color }}>{from.label}</span>
                <svg className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 8h10M10 5l3 3-3 3" />
                </svg>
                <span className="text-sm">{to.emoji}</span>
                <span className="text-xs font-medium" style={{ color: to.color }}>{to.label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums">{edge.message_count}</span>
                <span className="text-[10px] text-muted-foreground/30">{timeAgo(edge.last_message_at)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-3">💬</div>
      <p className="text-sm font-medium text-muted-foreground">No messages yet</p>
      <p className="text-xs text-muted-foreground/50 mt-1 max-w-[280px]">
        When agents talk to each other, their conversations will show up here like a group chat.
      </p>
    </div>
  )
}
