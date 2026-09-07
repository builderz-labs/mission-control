'use client'

import { useRef } from 'react'
import { isTreeKind } from '@/lib/chat-session-identity'
import { isAgentWorking } from '@/lib/session-transcript-types'
import { contextPercent, formatDuration, parseSessionTokens, sessionDurationMs } from '@/lib/chat-session-metrics'
import type { ChatPullRequest } from '@/lib/github-pulls'
import { useTailScroll } from '@/lib/use-tail-scroll'
import type { Conversation } from '@/store'
import { HandoffBanner, transcriptExcerpt } from './handoff-banner'
import { SessionHeader } from './session-header'
import { SessionPrChip } from './session-pr-chip'
import { SessionStatusBar } from './session-status-bar'
import { SessionThread } from './session-thread'
import { FlySessionStatus } from './fly-session-status'
import type { SessionTranscriptMessage } from '../session-message'

export function ChatSessionPane({
  conversation,
  project,
  messages,
  loading,
  error,
  pr,
  prHidden,
  onDismissPr,
  onHandoff,
  busy = false,
}: {
  conversation: Conversation
  project: string
  messages: SessionTranscriptMessage[]
  loading: boolean
  error: string | null
  pr?: ChatPullRequest
  prHidden: boolean
  onDismissPr: () => void
  onHandoff: (nextId: string | null, kind?: string) => void
  busy?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // A thread opens on its newest message, the way every chat client does.
  const { following, jumpToLatest } = useTailScroll(scrollRef, {
    key: conversation.id,
    count: messages.length,
  })

  const session = conversation.session
  if (!session) return null
  const parsed = parseSessionTokens(session.tokens)
  const percent = contextPercent(session.tokens, session.model)
  const duration = formatDuration(sessionDurationMs(session.startTime, session.lastActivity))
  const title = conversation.name || session.displayName || session.sessionId
  const live = isAgentWorking(messages, { active: session.active, busy })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader title={title} project={project} kind={session.sessionKind} />
      <FlySessionStatus sessionId={session.sessionId} />
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          {loading && messages.length === 0 && <p className="px-8 pt-6 text-[13px] text-[var(--chat-muted)]">Loading…</p>}
          {error && <p className="px-8 pt-6 text-[13px] text-red-400">{error}</p>}
          <SessionThread messages={messages} live={live} />
        </div>
        {!following && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-6 rounded-full bg-primary/90 px-3 py-1 text-2xs font-medium text-primary-foreground shadow-lg"
          >
            Jump to latest ↓
          </button>
        )}
      </div>
      <SessionStatusBar
        tokens={parsed.label !== '0' ? parsed.label : session.tokens}
        duration={duration}
        percent={percent}
        status={busy ? 'Thinking' : session.active ? 'Active' : 'Idle'}
        live={live}
      />
      <div className="px-6">
        {!prHidden && pr && (
          <SessionPrChip number={pr.number} repo={pr.repo} href={pr.htmlUrl} additions={pr.additions} deletions={pr.deletions} onDismiss={onDismissPr} />
        )}
        {isTreeKind(session.sessionKind) ? (
          <HandoffBanner
            sessionId={conversation.id}
            sourceKind={session.sessionKind}
            sourceAgent={session.agent}
            sourceId={session.sessionId}
            title={title}
            project={session.workingDir || project}
            excerpt={transcriptExcerpt(messages)}
            percent={percent}
            onComplete={onHandoff}
          />
        ) : null}
      </div>
    </div>
  )
}
