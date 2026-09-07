'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TerminalView } from '@/components/terminal/terminal-view'
import { useTailScroll } from '@/lib/use-tail-scroll'
import type { Conversation } from '@/store'
import { SessionMessage, shouldShowTimestamp, type SessionTranscriptMessage } from '../session-message'
import { getSessionKindLabel, SessionKindAvatar } from '../session-kind-brand'

export function OverlaySessionView({
  session,
  messages,
  loading,
  error,
  onRefresh,
  onContinue,
  busy,
  continueError,
}: {
  session: NonNullable<Conversation['session']>
  messages: SessionTranscriptMessage[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onContinue: (prompt: string) => Promise<void>
  busy: boolean
  continueError: string | null
}) {
  const isPty = session.sessionKind === 'claude-code' || session.sessionKind === 'codex-cli'
  const [viewMode, setViewMode] = useState<'terminal' | 'transcript'>('transcript')
  const [prompt, setPrompt] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Opens on the newest message and keeps following until the reader scrolls up.
  useTailScroll(scrollRef, { key: session.sessionId, count: messages.length })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
        <SessionKindAvatar kind={session.sessionKind} fallback={getSessionKindLabel(session.sessionKind).slice(0, 1)} sizeClassName="w-5 h-5" />
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${session.active ? 'bg-green-500/20 text-green-300' : 'bg-muted text-muted-foreground'}`}>
          {session.active ? 'active' : 'idle'}
        </span>
        <span>{getSessionKindLabel(session.sessionKind)}</span>
        {session.model && <span className="text-muted-foreground/60">{session.model}</span>}
        {isPty && (
          <div className="ml-auto flex overflow-hidden rounded-md border border-border/50">
            <button type="button" onClick={() => setViewMode('terminal')} className={`px-2 py-0.5 text-[10px] ${viewMode === 'terminal' ? 'bg-secondary text-foreground' : ''}`}>Terminal</button>
            <button type="button" onClick={() => setViewMode('transcript')} className={`border-l border-border/50 px-2 py-0.5 text-[10px] ${viewMode === 'transcript' ? 'bg-secondary text-foreground' : ''}`}>Transcript</button>
          </div>
        )}
      </div>
      {isPty && viewMode === 'terminal' && (session.sessionKind === 'claude-code' || session.sessionKind === 'codex-cli') ? (
        <div className="min-h-0 flex-1">
          <TerminalView sessionId={session.sessionId} sessionKind={session.sessionKind} mode="readonly" onError={() => setViewMode('transcript')} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2 font-mono-tight">
          {loading && <div className="px-4 text-xs text-muted-foreground/50">Loading transcript...</div>}
          {error && <div className="px-4 text-xs text-red-400">{error}</div>}
          {!loading && !error && messages.map((msg, idx) => (
            <SessionMessage key={`${msg.timestamp || 'no-ts'}-${idx}`} message={msg} showTimestamp={shouldShowTimestamp(msg, messages[idx - 1])} />
          ))}
        </div>
      )}
      <div className="border-t border-border/50 px-4 py-2">
        {continueError && <div className="mb-1 text-xs text-red-400">{continueError}</div>}
        <div className="flex items-center gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!prompt.trim()) return
                void onContinue(prompt.trim()).then(() => {
                  setPrompt('')
                  onRefresh()
                })
              }
            }}
            placeholder="Send prompt to this session..."
            className="h-7 flex-1 rounded border border-border/40 bg-surface-1 px-2 text-xs"
          />
          <Button size="sm" variant="ghost" disabled={busy || !prompt.trim()} onClick={() => {
            void onContinue(prompt.trim()).then(() => { setPrompt(''); onRefresh() })
          }}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
