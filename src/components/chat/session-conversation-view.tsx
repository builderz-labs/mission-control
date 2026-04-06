'use client'

import { useEffect, useRef, useState } from 'react'
import { type Conversation } from '@/store'
import { Button } from '@/components/ui/button'
import { SessionMessage, shouldShowTimestamp, type SessionTranscriptMessage } from './session-message'
import { getSessionKindLabel, SessionKindAvatar } from './session-kind-brand'

interface SessionConversationViewProps {
  session: NonNullable<Conversation['session']>
  messages: SessionTranscriptMessage[]
  loading: boolean
  error: string | null
  onRefreshTranscript: () => void
  onSavePreferences: (payload: {
    prefKey: string
    displayName?: string
    colorTag?: string
  }) => Promise<void>
}

/**
 * Renders the full session view: info bar, transcript, and continue-session input.
 * Extracted from ChatWorkspace to keep each file under 400 lines.
 */
export function SessionConversationView({
  session,
  messages,
  loading,
  error,
  onRefreshTranscript,
  onSavePreferences,
}: SessionConversationViewProps): React.ReactElement {
  const isGatewaySession = session.sessionKind === 'gateway'
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const [continuePrompt, setContinuePrompt] = useState('')
  const [continueBusy, setContinueBusy] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [lastReply, setLastReply] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState(session.displayName || '')
  const [colorDraft, setColorDraft] = useState(session.colorTag || '')
  const [prefBusy, setPrefBusy] = useState(false)
  const [prefError, setPrefError] = useState<string | null>(null)

  const hasPrefChanges =
    nameDraft.trim() !== (session.displayName || '').trim() ||
    colorDraft !== (session.colorTag || '')

  // Reset local draft state when the underlying session identity changes
  useEffect(() => {
    setNameDraft(session.displayName || '')
    setColorDraft(session.colorTag || '')
    setPrefError(null)
    setContinueError(null)
    setLastReply(null)
  }, [session.prefKey, session.displayName, session.colorTag])

  // Auto-scroll to bottom when transcript or reply updates
  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [messages, loading, lastReply])

  const handleContinueSession = async (): Promise<void> => {
    const prompt = continuePrompt.trim()
    if (!prompt || continueBusy) return

    setContinueBusy(true)
    setContinueError(null)
    setLastReply(null)

    try {
      if (isGatewaySession) {
        // Gateway sessions: forward message to the agent via chat messages API
        const agentName = session.agent || session.sessionId.split(':')[1] || 'unknown'
        const res = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'human',
            to: agentName,
            content: prompt,
            conversation_id: `agent_${agentName}`,
            message_type: 'text',
            forward: true,
            sessionKey: session.sessionKey || undefined,
          }),
          signal: AbortSignal.timeout(8000),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to send message')
        }
        const fwd = data?.forward || data?.message?.metadata?.forwardInfo
        if (fwd?.attempted && !fwd?.delivered) {
          setContinueError(`Message saved but not delivered: ${fwd.reason || 'unknown'}`)
        }
        setContinuePrompt('')
        // Refresh transcript after a short delay to capture the response
        setTimeout(() => onRefreshTranscript(), 2000)
      } else {
        const res = await fetch('/api/sessions/continue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: session.sessionKind,
            id: session.sessionId,
            prompt,
          }),
          signal: AbortSignal.timeout(8000),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to continue session')
        }
        setContinuePrompt('')
        if (typeof data?.reply === 'string' && data.reply.trim()) {
          setLastReply(data.reply.trim())
        }
        onRefreshTranscript()
      }
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : 'Failed to continue session')
    } finally {
      setContinueBusy(false)
    }
  }

  const handleSavePrefs = async (): Promise<void> => {
    if (!session.prefKey || prefBusy) return
    setPrefBusy(true)
    setPrefError(null)
    try {
      await onSavePreferences({
        prefKey: session.prefKey,
        displayName: nameDraft.trim() || undefined,
        colorTag: colorDraft || undefined,
      })
    } catch (err) {
      setPrefError(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setPrefBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Compact session info bar */}
      <div className="border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {!isGatewaySession && (
            <SessionKindAvatar
              kind={session.sessionKind}
              fallback={getSessionKindLabel(session.sessionKind).slice(0, 1)}
              sizeClassName="w-5 h-5"
            />
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${session.active ? 'bg-green-500/20 text-green-300' : 'bg-muted text-muted-foreground'}`}>
            {session.active ? 'active' : 'idle'}
          </span>
          <span className="font-mono-tight">{getSessionKindLabel(session.sessionKind)}</span>
          {session.model && <span className="text-muted-foreground/60">{session.model}</span>}
          {session.tokens && <span className="text-muted-foreground/60">{session.tokens}</span>}
          {session.workingDir && (
            <span className="hidden truncate text-muted-foreground/50 sm:inline max-w-[200px]">
              {session.workingDir}
            </span>
          )}
          {session.age && <span className="text-muted-foreground/40">{session.age} ago</span>}
        </div>

        {/* Collapsible settings — not available for gateway sessions */}
        {!isGatewaySession && (
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground/80">
              Settings
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Rename session"
                maxLength={80}
                className="h-7 rounded border border-border/60 bg-surface-1 px-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <select
                value={colorDraft}
                onChange={(e) => setColorDraft(e.target.value)}
                className="h-7 rounded border border-border/60 bg-surface-1 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="">No color</option>
                <option value="slate">Slate</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="amber">Amber</option>
                <option value="red">Red</option>
                <option value="purple">Purple</option>
                <option value="pink">Pink</option>
                <option value="teal">Teal</option>
              </select>
              <Button
                onClick={handleSavePrefs}
                size="sm"
                variant="outline"
                disabled={prefBusy || !session.prefKey || !hasPrefChanges}
                className="h-7 px-3 text-xs"
              >
                {prefBusy ? 'Saving...' : 'Save'}
              </Button>
            </div>
            {prefError && <div className="mt-2 text-xs text-red-400">{prefError}</div>}
          </details>
        )}
      </div>

      {/* Transcript */}
      <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto font-mono-tight py-2">
        {loading && (
          <div className="space-y-2 px-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-1/60" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-1/60" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-1/60" />
            <div className="text-xs text-muted-foreground/50">Loading transcript...</div>
          </div>
        )}
        {!loading && error && (
          <div className="px-4 text-xs text-red-400">{error}</div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="px-4 text-xs text-muted-foreground">
            {isGatewaySession
              ? 'No messages loaded for this gateway session.'
              : 'No transcript snippets found for this session.'}
          </div>
        )}
        {!loading && !error && messages.length > 0 && (
          <div className="space-y-0">
            {messages.map((msg, idx) => (
              <SessionMessage
                key={`${msg.timestamp || 'no-ts'}-${idx}`}
                message={msg}
                showTimestamp={shouldShowTimestamp(msg, messages[idx - 1])}
              />
            ))}
          </div>
        )}
      </div>

      {/* Continue session input */}
      <div className="border-t border-border/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono-tight text-xs ${isGatewaySession ? 'text-cyan-400/60' : 'text-green-400/60'}`}>
            {isGatewaySession ? '>' : '$'}
          </span>
          <input
            value={continuePrompt}
            onChange={(e) => setContinuePrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleContinueSession()
              }
            }}
            placeholder={
              isGatewaySession
                ? 'Send message to this agent session...'
                : 'Send prompt to this local session...'
            }
            className="h-7 flex-1 rounded border border-border/40 bg-surface-1 px-2 font-mono-tight text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <Button
            onClick={handleContinueSession}
            size="sm"
            variant="ghost"
            disabled={continueBusy || !continuePrompt.trim()}
            className="h-7 px-3 text-xs"
          >
            {continueBusy ? '...' : 'Send'}
          </Button>
        </div>
        {continueError && <div className="mt-1 text-xs text-red-400">{continueError}</div>}
        {lastReply && (
          <div className="mt-2 border-l-2 border-primary/30 pl-3">
            <div className="font-mono-tight text-xs leading-relaxed text-foreground whitespace-pre-wrap">
              {lastReply}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
