'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { Button } from '@/components/ui/button'
import {
  SessionMessage,
  shouldShowTimestamp,
  type SessionTranscriptMessage,
} from '@/components/chat/session-message'
import { getErrorMessage } from '@/lib/types/sql'

interface TaskSessionFeedProps {
  sessionId: string
  agentName?: string
  isLive: boolean
}

/**
 * Displays the live or historical transcript for an agent session attached
 * to a task. Polls every 5 s while the task is in_progress.
 */
export function TaskSessionFeed({ sessionId, agentName, isLive }: TaskSessionFeedProps) {
  const [messages, setMessages] = useState<SessionTranscriptMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const fetchTranscript = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/transcript?kind=claude-code&id=${encodeURIComponent(sessionId)}&limit=100`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`)
      const data = await res.json()
      setMessages(data.messages || [])
      setError(null)
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load session transcript')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Initial fetch
  useEffect(() => { fetchTranscript() }, [fetchTranscript])

  // Auto-refresh when live — stop polling once the task leaves in_progress
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(fetchTranscript, 5000)
    return () => clearInterval(interval)
  }, [isLive, fetchTranscript])

  // Auto-scroll only when new messages arrive (not on every render)
  useEffect(() => {
    if (messages.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevCountRef.current = messages.length
  }, [messages.length])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {agentName && (
            <span className="flex items-center gap-1.5">
              <AgentAvatar name={agentName} size="xs" />
              <span className="font-medium text-foreground">{agentName}</span>
            </span>
          )}
          <span className="font-mono text-muted-foreground/50">{sessionId.slice(0, 12)}...</span>
          {isLive && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <Button variant="link" size="xs" onClick={fetchTranscript} className="text-blue-400 hover:text-blue-300">
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm py-4 text-center">Loading transcript...</div>
      ) : messages.length === 0 ? (
        <div className="text-muted-foreground/50 text-sm py-4 text-center">
          No messages in this session yet.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-[50vh] overflow-y-auto space-y-0.5 rounded border border-border/30 bg-black/10 p-2"
        >
          {messages.map((msg, idx) => (
            <SessionMessage
              key={idx}
              message={msg}
              showTimestamp={shouldShowTimestamp(msg, messages[idx - 1])}
            />
          ))}
        </div>
      )}
    </div>
  )
}
