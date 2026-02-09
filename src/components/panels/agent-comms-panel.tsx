'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'

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
}

const AGENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  jarv: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-500' },
  forge: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
  aegis: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-500' },
  research: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  design: { bg: 'bg-pink-500/10', text: 'text-pink-400', dot: 'bg-pink-500' },
  quant: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-500' },
  ops: { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-500' },
  reviewer: { bg: 'bg-teal-500/10', text: 'text-teal-400', dot: 'bg-teal-500' },
  content: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-500' },
  seo: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-500' },
  security: { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-500' },
  ai: { bg: 'bg-violet-500/10', text: 'text-violet-400', dot: 'bg-violet-500' },
  'frontend-dev': { bg: 'bg-sky-500/10', text: 'text-sky-400', dot: 'bg-sky-500' },
  'backend-dev': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  'solana-dev': { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-500' },
  hermes: { bg: 'bg-lime-500/10', text: 'text-lime-400', dot: 'bg-lime-500' },
  apollo: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400', dot: 'bg-fuchsia-500' },
}

function getTheme(name: string) {
  return AGENT_COLORS[name.toLowerCase()] || { bg: 'bg-muted/50', text: 'text-muted-foreground', dot: 'bg-muted-foreground' }
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
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
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function AgentCommsPanel() {
  const [data, setData] = useState<CommsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [view, setView] = useState<'timeline' | 'graph'>('timeline')
  const [expandedMsg, setExpandedMsg] = useState<number | null>(null)

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

  useSmartPoll(fetchComms, 30000)

  // Get unique agents from graph stats
  const agents = data?.graph.agentStats.map(s => s.agent) || []

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm">Loading agent communications...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Agent Communications</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data?.total || 0} inter-agent messages
            {agents.length > 0 && ` across ${agents.length} agents`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-surface-1 rounded-lg p-0.5 border border-border">
            <button
              onClick={() => setView('timeline')}
              className={`px-3 py-1 text-xs rounded-md transition-smooth ${
                view === 'timeline' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Timeline
            </button>
            <button
              onClick={() => setView('graph')}
              className={`px-3 py-1 text-xs rounded-md transition-smooth ${
                view === 'graph' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Graph
            </button>
          </div>

          {/* Agent filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-surface-1 border border-border rounded-lg px-2 py-1.5 text-xs text-foreground"
          >
            <option value="all">All Agents</option>
            {agents.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {view === 'graph' ? (
        <CommGraph edges={data?.graph.edges || []} agentStats={data?.graph.agentStats || []} />
      ) : (
        <CommTimeline
          messages={data?.messages || []}
          expandedMsg={expandedMsg}
          onToggle={(id) => setExpandedMsg(expandedMsg === id ? null : id)}
        />
      )}
    </div>
  )
}

// ── Communication Graph View ──

function CommGraph({ edges, agentStats }: { edges: GraphEdge[]; agentStats: AgentStat[] }) {
  if (agentStats.length === 0) {
    return <EmptyState />
  }

  const maxMessages = Math.max(...agentStats.map(s => s.sent + s.received), 1)

  return (
    <div className="space-y-4">
      {/* Agent stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {agentStats.map(stat => {
          const theme = getTheme(stat.agent)
          const total = stat.sent + stat.received
          const barWidth = Math.max((total / maxMessages) * 100, 5)

          return (
            <div key={stat.agent} className={`${theme.bg} border ${theme.bg.replace('/10', '/20')} rounded-lg p-3 space-y-2`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${theme.dot}`} />
                <span className={`text-sm font-medium ${theme.text}`}>{stat.agent}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span title="Sent">
                  <svg className="inline w-3 h-3 mr-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2 8h12M10 4l4 4-4 4" />
                  </svg>
                  {stat.sent}
                </span>
                <span title="Received">
                  <svg className="inline w-3 h-3 mr-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 8H2M6 4L2 8l4 4" />
                  </svg>
                  {stat.received}
                </span>
              </div>
              <div className="h-1 bg-black/20 rounded-full overflow-hidden">
                <div className={`h-full ${theme.dot} rounded-full transition-all`} style={{ width: `${barWidth}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Communication edges */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Communication Channels</h3>
        <div className="space-y-1">
          {edges.map((edge, i) => {
            const fromTheme = getTheme(edge.from_agent)
            const toTheme = getTheme(edge.to_agent)
            return (
              <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surface-1 border border-border/50 hover:border-border transition-smooth">
                <span className={`text-xs font-medium ${fromTheme.text}`}>{edge.from_agent}</span>
                <svg className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 8h10M10 5l3 3-3 3" />
                </svg>
                <span className={`text-xs font-medium ${toTheme.text}`}>{edge.to_agent}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">{edge.message_count} msgs</span>
                <span className="text-[10px] text-muted-foreground/40">{timeAgo(edge.last_message_at)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Timeline View ──

function CommTimeline({
  messages,
  expandedMsg,
  onToggle
}: {
  messages: CommsMessage[]
  expandedMsg: number | null
  onToggle: (id: number) => void
}) {
  if (messages.length === 0) {
    return <EmptyState />
  }

  // Group messages by date
  const groups: { date: string; messages: CommsMessage[] }[] = []
  let currentDate = ''

  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, messages: [] })
    }
    groups[groups.length - 1].messages.push(msg)
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <div key={group.date}>
          {/* Date separator */}
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">{group.date}</span>
            <div className="h-px flex-1 bg-border/50" />
          </div>

          {/* Messages */}
          <div className="space-y-1.5">
            {group.messages.map(msg => (
              <CommMessage key={msg.id} message={msg} expanded={expandedMsg === msg.id} onToggle={() => onToggle(msg.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CommMessage({ message, expanded, onToggle }: { message: CommsMessage; expanded: boolean; onToggle: () => void }) {
  const fromTheme = getTheme(message.from_agent)
  const toTheme = getTheme(message.to_agent)
  const isHandoff = message.message_type === 'handoff'
  const isStatus = message.message_type === 'status'
  const preview = message.content.length > 120 ? message.content.slice(0, 120) + '...' : message.content

  return (
    <div
      onClick={onToggle}
      className={`group rounded-lg border transition-smooth cursor-pointer ${
        expanded
          ? 'bg-surface-2 border-border'
          : 'bg-surface-1 border-border/50 hover:border-border hover:bg-surface-2'
      }`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2">
        {/* From avatar */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${fromTheme.bg} ${fromTheme.text} mt-0.5`}>
          {message.from_agent.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header: from -> to + time */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs font-medium ${fromTheme.text}`}>{message.from_agent}</span>
            <svg className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 3l6 5-6 5" />
            </svg>
            <span className={`text-xs font-medium ${toTheme.text}`}>{message.to_agent}</span>

            {isHandoff && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">handoff</span>
            )}
            {isStatus && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">status</span>
            )}

            <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums flex-shrink-0">
              {formatTime(message.created_at)}
            </span>
          </div>

          {/* Content */}
          <div className={`mt-1 text-xs text-muted-foreground leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            {expanded ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : (
              preview
            )}
          </div>

          {/* Metadata tags */}
          {expanded && message.metadata && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(message.metadata).map(([k, v]) => (
                <span key={k} className="text-[9px] px-1.5 py-0.5 rounded bg-surface-1 border border-border text-muted-foreground">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-surface-1 border border-border flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-muted-foreground/40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h8l4 4v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" />
          <path d="M5 8h6M5 11h3" />
        </svg>
      </div>
      <p className="text-sm font-medium text-muted-foreground">No inter-agent messages yet</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[250px]">
        When agents communicate with each other via sessions_send, their messages will appear here.
      </p>
    </div>
  )
}
