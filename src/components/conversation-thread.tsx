'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl, type Task } from '@/store'
import { getAgentIdentity } from '@/lib/agent-identity'

// ─── Types ───

interface ReviewItem {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string | null
  created_by: string
  created_at: number
  updated_at: number
  outcome: string | null
  error_message: string | null
  tags: string[]
  ticket_ref: string | null
  project_name: string | null
  payload: {
    answer: string | null
    clickupTaskUrl: string | null
    files: Array<{ name: string; url: string | null; size: number | null; mime: string | null }>
    extra: Record<string, unknown>
    isStructured: boolean
    cardSummary: string[]
  }
}

/** A unified thread message — either a dispatch (operator) or a reply (agent) */
interface ThreadMessage {
  id: string
  type: 'dispatch' | 'reply'
  timestamp: number
  // Dispatch fields
  operation?: string
  agentTarget?: string
  schedule?: string | null
  // Reply fields
  taskId?: number
  agentHandle?: string
  agentRoleTitle?: string
  agentIcon?: string
  status?: string
  outcome?: string | null
  answer?: string | null
  cardSummary?: string[]
  errorMessage?: string | null
  ticketRef?: string | null
  clickupUrl?: string | null
  files?: Array<{ name: string; url: string | null }>
}

// ─── ConversationThread ───

export function ConversationThread() {
  const { tasks } = useMissionControl()
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // Fetch review queue items (agent replies)
  const fetchReviewQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/jarvis/review-queue?status=review,quality_review,done,in_progress&limit=50')
      if (!res.ok) return
      const data = await res.json()
      setReviewItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReviewQueue()
    const interval = setInterval(fetchReviewQueue, 15_000) // poll every 15s
    return () => clearInterval(interval)
  }, [fetchReviewQueue])

  // Build unified thread from dispatches (tasks with dispatch_source: 'lab') + review items
  const thread = useMemo(() => {
    const messages: ThreadMessage[] = []

    // Dispatches: tasks created by mission-control with dispatch_source: 'lab'
    const dispatchTasks = tasks.filter(t => {
      const meta = t.metadata as Record<string, unknown> | undefined
      return meta?.dispatch_source === 'lab' || t.created_by === 'mission-control'
    })

    for (const task of dispatchTasks) {
      const meta = task.metadata as Record<string, unknown> | undefined
      messages.push({
        id: `dispatch-${task.id}`,
        type: 'dispatch',
        timestamp: task.created_at,
        operation: task.description || task.title,
        agentTarget: (meta?.agent_id as string) || task.assigned_to || undefined,
        schedule: (meta?.schedule as string) || null,
      })
    }

    // Replies: review queue items (these are tasks that have agent results)
    for (const item of reviewItems) {
      const identity = item.assigned_to ? getAgentIdentity(item.assigned_to) : null
      messages.push({
        id: `reply-${item.id}`,
        type: 'reply',
        timestamp: item.updated_at,
        taskId: item.id,
        agentHandle: item.assigned_to ? `@${item.assigned_to}` : undefined,
        agentRoleTitle: identity?.roleTitle || item.assigned_to || 'Agent',
        agentIcon: identity?.icon || 'Bot',
        status: item.status,
        outcome: item.outcome,
        answer: item.payload.answer,
        cardSummary: item.payload.cardSummary,
        errorMessage: item.error_message,
        ticketRef: item.ticket_ref,
        clickupUrl: item.payload.clickupTaskUrl,
        files: item.payload.files.map(f => ({ name: f.name, url: f.url })),
      })
    }

    // Sort by timestamp, oldest first (newest at bottom)
    return messages.sort((a, b) => a.timestamp - b.timestamp)
  }, [tasks, reviewItems])

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length])

  const toggleExpand = useCallback((id: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Approve: move task to done
  const handleApprove = useCallback(async (taskId: number) => {
    setActionLoading(`approve-${taskId}`)
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', outcome: 'success' }),
      })
      fetchReviewQueue()
    } catch {
      // silently fail
    } finally {
      setActionLoading(null)
    }
  }, [fetchReviewQueue])

  // Redirect: reassign to a different agent (re-open as inbox)
  const handleRedirect = useCallback(async (taskId: number) => {
    setActionLoading(`redirect-${taskId}`)
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inbox' }),
      })
      fetchReviewQueue()
    } catch {
      // silently fail
    } finally {
      setActionLoading(null)
    }
  }, [fetchReviewQueue])

  if (loading && thread.length === 0) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">Loading conversation\u2026</p>
      </div>
    )
  }

  if (thread.length === 0) {
    return (
      <div className="desk-panel p-8 text-center">
        <p className="text-sm text-muted-foreground">No dispatches or results yet.</p>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Use the dispatch form above to send your first instruction.<br />
          Agent replies will appear here as a conversation thread.
        </p>
      </div>
    )
  }

  return (
    <div className="desk-panel overflow-hidden">
      <div className="panel-header">
        <h3 className="text-sm font-semibold text-foreground">Conversation</h3>
        <span className="text-2xs font-mono-tight text-muted-foreground">{thread.length} messages</span>
      </div>
      <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
        {thread.map(msg =>
          msg.type === 'dispatch' ? (
            <DispatchBubble key={msg.id} msg={msg} />
          ) : (
            <ReplyBubble
              key={msg.id}
              msg={msg}
              isExpanded={expandedReplies.has(msg.id)}
              onToggleExpand={() => toggleExpand(msg.id)}
              onApprove={() => msg.taskId && handleApprove(msg.taskId)}
              onRedirect={() => msg.taskId && handleRedirect(msg.taskId)}
              actionLoading={actionLoading}
            />
          )
        )}
        <div ref={threadEndRef} />
      </div>
    </div>
  )
}

// ─── Dispatch Bubble (right side, terracotta) ───

function DispatchBubble({ msg }: { msg: ThreadMessage }) {
  const timeStr = formatTime(msg.timestamp)
  const agentIdentity = msg.agentTarget ? getAgentIdentity(msg.agentTarget) : null

  return (
    <div className="flex justify-end">
      <div className="max-w-[75%]">
        <div
          className="rounded-2xl rounded-br-md px-4 py-3 text-sm"
          style={{
            background: 'oklch(0.60 0.14 40 / 0.12)',
            borderLeft: '3px solid oklch(0.60 0.14 40)',
          }}
        >
          <p className="text-foreground leading-relaxed whitespace-pre-wrap">{msg.operation}</p>
          {msg.schedule && (
            <p className="text-xs text-muted-foreground mt-1.5 italic">
              Schedule: {msg.schedule}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 mt-1 px-1">
          {agentIdentity && (
            <span className="text-2xs text-muted-foreground">
              \u2192 {agentIdentity.roleTitle}
            </span>
          )}
          <span className="text-2xs text-muted-foreground/60">{timeStr}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Reply Bubble (left side, with agent avatar) ───

function ReplyBubble({
  msg,
  isExpanded,
  onToggleExpand,
  onApprove,
  onRedirect,
  actionLoading,
}: {
  msg: ThreadMessage
  isExpanded: boolean
  onToggleExpand: () => void
  onApprove: () => void
  onRedirect: () => void
  actionLoading: string | null
}) {
  const timeStr = formatTime(msg.timestamp)
  const isReviewable = msg.status === 'review' || msg.status === 'quality_review'
  const hasFullAnswer = msg.answer && msg.answer.length > 200

  return (
    <div className="flex justify-start gap-2.5">
      {/* Agent avatar circle */}
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {(msg.agentRoleTitle || 'A').charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="max-w-[75%]">
        {/* Agent handle + timestamp */}
        <div className="flex items-center gap-2 mb-1 px-1">
          <span className="text-2xs font-semibold text-foreground">{msg.agentRoleTitle}</span>
          {msg.agentHandle && (
            <span className="text-2xs text-muted-foreground font-mono-tight">{msg.agentHandle}</span>
          )}
          <span className="text-2xs text-muted-foreground/60">{timeStr}</span>
        </div>

        {/* Reply content */}
        <div
          className="rounded-2xl rounded-bl-md px-4 py-3 text-sm bg-card border border-border/60 cursor-pointer"
          onClick={onToggleExpand}
        >
          {/* Card summary bullets */}
          {msg.cardSummary && msg.cardSummary.length > 0 && (
            <ul className="space-y-1 mb-2">
              {msg.cardSummary.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                  <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Answer text */}
          {msg.answer && (
            <div className={`text-sm text-foreground/85 leading-relaxed ${
              !isExpanded && hasFullAnswer ? 'line-clamp-3' : ''
            }`}>
              <p className="whitespace-pre-wrap">{msg.answer}</p>
            </div>
          )}

          {/* Error message */}
          {msg.errorMessage && (
            <p className="text-xs text-destructive mt-1.5">{msg.errorMessage}</p>
          )}

          {/* Expand hint */}
          {hasFullAnswer && !isExpanded && (
            <p className="text-2xs text-primary mt-1.5">Click to expand full result</p>
          )}

          {/* Links */}
          {(msg.clickupUrl || (msg.files && msg.files.length > 0)) && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
              {msg.clickupUrl && (
                <a
                  href={msg.clickupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xs text-primary hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  ClickUp Task \u2197
                </a>
              )}
              {msg.files?.map((f, i) => (
                f.url ? (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xs text-primary hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {f.name} \u2197
                  </a>
                ) : (
                  <span key={i} className="text-2xs text-muted-foreground">{f.name}</span>
                )
              ))}
            </div>
          )}

          {/* Status badge */}
          {msg.outcome && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <span className={`text-2xs px-2 py-0.5 rounded-full ${
                msg.outcome === 'success' ? 'badge-success' :
                msg.outcome === 'failed' ? 'badge-error' :
                msg.outcome === 'partial' ? 'badge-warning' :
                'badge-neutral'
              }`}>
                {msg.outcome}
              </span>
            </div>
          )}
        </div>

        {/* Approve / Redirect buttons — only for reviewable items */}
        {isReviewable && (
          <div className="flex items-center gap-2 mt-2 px-1">
            <Button
              variant="outline"
              size="sm"
              className="text-2xs h-7 px-3 text-success border-success/30 hover:bg-success/10"
              disabled={actionLoading === `approve-${msg.taskId}`}
              onClick={onApprove}
            >
              {actionLoading === `approve-${msg.taskId}` ? 'Approving\u2026' : 'Approve'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-2xs h-7 px-3"
              disabled={actionLoading === `redirect-${msg.taskId}`}
              onClick={onRedirect}
            >
              {actionLoading === `redirect-${msg.taskId}` ? 'Redirecting\u2026' : 'Redirect'}
            </Button>
            {msg.ticketRef && (
              <span className="text-2xs text-muted-foreground font-mono-tight ml-auto">{msg.ticketRef}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ───

function formatTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
