'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useMissionControl } from '@/store'

import type { AggregateEvent } from '@/app/api/sessions/transcript/aggregate/route'

import {
  COORDINATOR_AGENT,
  FILTER_OPTIONS,
  type ActivityRecord,
  type CommsData,
  type FeedFilter,
  type Target,
} from './agent-comms-panel-types'
import { logsToFeed, commsToFeed, transcriptToFeed, activitiesToFeed, mergeFeedEvents, getIdentity } from './agent-comms-panel-utils'
import { FeedLine } from './agent-comms-feed-line'
import { SessionChip } from './agent-comms-session-chip'
import { EmptyState } from './agent-comms-empty-state'
import { ConnectionBadge, SourceBadge } from './agent-comms-badges'

// ── AgentCommsPanel ──
// Thin shell: owns all state + data-fetching, delegates rendering to sub-components.

export function AgentCommsPanel(): React.ReactElement {
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

  const { logs, sessions, connection, currentUser } = useMissionControl()

  // Fetch DB-backed comms messages
  const fetchComms = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/agents/comms?limit=200', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json() as CommsData
      setCommsData(json)
      setError(null)
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useSmartPoll(fetchComms, 15000)

  // Fetch aggregated transcript events from all gateway sessions
  const fetchTranscripts = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/sessions/transcript/aggregate?limit=200', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const json = await res.json() as { events?: AggregateEvent[]; sessionCount?: number }
      setTranscriptData(json.events ?? [])
      setTranscriptSessionCount(json.sessionCount ?? 0)
    } catch {
      // Silent — transcript is supplementary data
    }
  }, [])

  useSmartPoll(fetchTranscripts, 20000)

  // Fetch memory/agent activity events
  const fetchActivities = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        '/api/activities?type=agent_memory_updated,agent_memory_cleared,memory_file_saved,memory_file_created,memory_file_deleted&limit=50',
        { signal: AbortSignal.timeout(8000) },
      )
      if (!res.ok) return
      const json = await res.json() as { activities?: ActivityRecord[] }
      setActivityEvents(json.activities ?? [])
    } catch {
      // Silent — activities are supplementary
    }
  }, [])

  useSmartPoll(fetchActivities, 30000)

  // Merge all sources into a single chronological, deduplicated feed
  const feedEvents = useMemo(() => mergeFeedEvents(
    logsToFeed(logs),
    commsToFeed(commsData?.messages ?? []),
    transcriptToFeed(transcriptData),
    activitiesToFeed(activityEvents),
  ), [logs, commsData?.messages, transcriptData, activityEvents])

  const filteredFeed = useMemo(
    () => filter === 'all' ? feedEvents : feedEvents.filter(e => e.category === filter),
    [feedEvents, filter],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { chat: 0, tools: 0, trace: 0, system: 0, safety: 0 }
    for (const e of feedEvents) counts[e.category] = (counts[e.category] ?? 0) + 1
    return counts
  }, [feedEvents])

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && feedContainerRef.current) {
      feedContainerRef.current.scrollTo({ top: feedContainerRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [filteredFeed.length, autoScroll])

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = useCallback((): void => {
    const el = feedContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(atBottom)
  }, [])

  // Send message to selected target (or coordinator fallback)
  const sendMessage = useCallback(async (): Promise<void> => {
    const content = draft.trim()
    if (!content || sending) return

    const toAgent = target?.name ?? COORDINATOR_AGENT
    const from = currentUser?.username ?? currentUser?.display_name ?? 'operator'
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
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
      const payload = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) {
        const injection = payload?.injection as Array<{ description?: string; rule?: string }> | undefined
        if (res.status === 422 && injection) {
          const rules = injection.map(i => i.description ?? i.rule).join('; ')
          throw new Error(`Message blocked: content triggered safety filter (${rules})`)
        }
        if (res.status === 403) throw new Error('You need operator access to send messages')
        throw new Error(String(payload?.error ?? 'Failed to send'))
      }

      const fwd = payload?.forward as Record<string, unknown> | undefined
      if (fwd?.attempted && !fwd?.delivered) {
        setSendError(`Sent, but not delivered to a live session (${String(fwd?.reason ?? 'unknown')}).`)
      }

      setDraft('')
      await fetchComms()
    } catch (err) {
      setSendError((err as Error).message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }, [draft, sending, target, currentUser, fetchComms])

  const sourceMode = commsData?.source?.mode ?? 'empty'
  const agents = commsData?.graph.agentStats.map(s => s.agent) ?? []

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
          <ConnectionBadge connection={connection} />
          {sourceMode !== 'empty' && <SourceBadge sourceMode={sourceMode} t={t} />}
        </div>
      </div>

      {/* Filter bar — mirrors TUI FeedFilter */}
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
            {opt.value !== 'all' && (categoryCounts[opt.value] ?? 0) > 0 && (
              <span className="ml-1 text-[9px] opacity-60">{categoryCounts[opt.value]}</span>
            )}
          </Button>
        ))}

        {(sessions.length > 0 || transcriptSessionCount > 0) && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t('sessions', { active: sessions.filter(s => s.active).length, total: transcriptSessionCount || sessions.length })}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-400 hover:text-red-300" onClick={fetchComms}>
            Retry
          </Button>
        </div>
      )}

      {/* Live sessions strip */}
      {sessions.length > 0 && (
        <div className="px-4 py-2 border-b border-border/20 flex-shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto">
            {sessions.map(s => {
              const agentName = s.key.split(':')[1] ?? s.kind
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

      {/* Auto-scroll resume button */}
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
                onClick={() => setTarget(isSelected ? null : { type: 'agent', name: a })}
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
                void sendMessage()
              }
            }}
            placeholder={
              target
                ? t('composerPlaceholderTarget', { name: getIdentity(target.name).label })
                : t('composerPlaceholderBroadcast')
            }
            className="flex-1 resize-none bg-card border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            rows={2}
          />
          <Button
            onClick={() => void sendMessage()}
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

