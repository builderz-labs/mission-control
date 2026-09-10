'use client'

import { useMemo } from 'react'
import { EngineLogoForText } from '@/components/brand/engine-logo'
import { useSessionTranscript } from '@/components/chat/use-session-transcript'
import { workingDirLeaf } from '@/lib/chat-display'
import { sessionTitle } from '@/lib/chat-session-identity'
import { normalizeCliKind } from '@/lib/cli-session-kinds'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import { isAgentWorking } from '@/lib/session-transcript-types'
import { terminalTabId } from '@/lib/terminal-sessions'
import { terminalCursorLabel, transcriptToTerminalLines } from '@/lib/terminal-transcript'
import { SessionTerminalView } from './session-terminal-view'

/** Every visible pane polls, so grid cells back off from the 1.5s single-pane cadence. */
const GRID_ACTIVE_MS = 4000
const GRID_IDLE_MS = 20000

export function terminalCellTitle(session: DashboardSession): string {
  return sessionTitle({
    customTitle: session.title,
    lastUserPrompt: session.lastUserPrompt,
    kind: normalizeCliKind(session.kind),
    id: session.id,
  })
}

/** Adapts a dashboard session row to the shape the shared transcript poller wants. */
function transcriptSubject(session: DashboardSession) {
  return {
    sessionId: session.id,
    sessionKey: session.key,
    sessionKind: normalizeCliKind(session.kind),
    active: session.active,
  }
}

/**
 * One terminal in the wall. Each cell owns its own transcript poll, the way a
 * VS Code split pane owns its own shell, and carries just enough chrome to say
 * which session it is and how to open it.
 */
export function SessionTerminalCell({
  session,
  focused,
  onFocus,
  onOpen,
}: {
  session: DashboardSession
  focused: boolean
  onFocus: () => void
  onOpen: () => void
}) {
  const { messages, loading, error } = useSessionTranscript(transcriptSubject(session), {
    activeMs: GRID_ACTIVE_MS,
    idleMs: GRID_IDLE_MS,
  })
  const lines = useMemo(() => transcriptToTerminalLines(messages), [messages])
  const working = useMemo(
    () => isAgentWorking(messages, { active: session.active }),
    [messages, session.active],
  )
  const dir = workingDirLeaf(session.workingDir)

  return (
    <section
      aria-label={`Terminal for ${terminalCellTitle(session)}`}
      onFocus={onFocus}
      onMouseDown={onFocus}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border transition-smooth ${
        focused ? 'border-primary/60 ring-1 ring-primary/40' : 'border-border/60'
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-secondary/30 px-2.5 py-1.5">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.active ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`}
        />
        <span className="min-w-0 flex-1 truncate text-2xs text-foreground">{terminalCellTitle(session)}</span>
        {dir && <span className="hidden shrink-0 font-mono-tight text-2xs text-muted-foreground lg:inline">{dir}</span>}
        <EngineLogoForText text={normalizeCliKind(session.kind)} size={12} decorative />
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-smooth hover:bg-secondary hover:text-foreground"
        >
          Open
        </button>
      </div>
      <SessionTerminalView
        compact
        sessionKey={terminalTabId(session)}
        lines={lines}
        cursor={terminalCursorLabel(working, !!session.active)}
        working={working}
        loading={loading}
        error={error}
        emptyLabel="No transcript yet."
      />
    </section>
  )
}
