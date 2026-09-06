'use client'

import { useEffect, useMemo, useState } from 'react'
import { EngineLogoForText } from '@/components/brand/engine-logo'
import { Button } from '@/components/ui/button'
import { useSessionTranscript } from '@/components/chat/use-session-transcript'
import { workingDirLeaf } from '@/lib/chat-display'
import { sessionTitle } from '@/lib/chat-session-identity'
import { cliKindLabel, normalizeCliKind } from '@/lib/cli-session-kinds'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import { isAgentWorking } from '@/lib/session-transcript-types'
import { terminalCursorLabel, transcriptToTerminalLines } from '@/lib/terminal-transcript'
import { orderTerminalSessions, terminalTabId } from '@/lib/terminal-sessions'
import type { DashboardData } from '../widget-primitives'
import { SessionTerminalView } from './session-terminal-view'

type TerminalWidgetData = Pick<
  DashboardData,
  'sessions' | 'isSessionsLoading' | 'openSession' | 'navigateToPanel'
>

/**
 * A terminal is a fixed viewport onto scrollback. Without a bounded height the
 * pane grows to the full transcript and the page scrolls instead, so the inner
 * scroller never overflows and auto-tail has nothing to follow.
 */
const TERMINAL_FRAME = 'flex h-[32rem] max-h-[70vh] flex-col lg:flex-row'

/** Adapts a dashboard session row to the shape the shared transcript poller wants. */
function transcriptSubject(session: DashboardSession | undefined) {
  if (!session) return undefined
  return {
    sessionId: session.id,
    sessionKey: session.key,
    sessionKind: normalizeCliKind(session.kind),
    active: session.active,
  }
}

export function SessionTerminalWidget({ data }: { data: TerminalWidgetData }) {
  const tabs = useMemo(() => orderTerminalSessions(data.sessions), [data.sessions])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(
    () => tabs.find((tab) => terminalTabId(tab) === selectedId) ?? tabs[0],
    [tabs, selectedId],
  )

  // Keep a valid selection when the session list churns underneath us.
  useEffect(() => {
    if (selected && terminalTabId(selected) !== selectedId) setSelectedId(terminalTabId(selected))
  }, [selected, selectedId])

  const { messages, loading, error } = useSessionTranscript(transcriptSubject(selected))
  const lines = useMemo(() => transcriptToTerminalLines(messages), [messages])
  const working = useMemo(
    () => isAgentWorking(messages, { active: selected?.active }),
    [messages, selected?.active],
  )

  return (
    <div className="panel flex flex-col">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">CLI Sessions — Terminal</h3>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground font-mono-tight">
            {tabs.filter((tab) => tab.active).length} live · {tabs.length}
          </span>
          <Button variant="outline" size="sm" onClick={() => data.navigateToPanel('sessions')}>
            All sessions
          </Button>
        </div>
      </div>

      {tabs.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-xs text-muted-foreground">
            {data.isSessionsLoading ? 'Loading sessions…' : 'No CLI sessions'}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground/60">
            Start a Claude, Codex, Grok, Kimi, Hermes, or OpenCode session to see its terminal here.
          </p>
        </div>
      ) : (
        <div className={TERMINAL_FRAME}>
          <TerminalTabList
            tabs={tabs}
            selectedId={selected ? terminalTabId(selected) : null}
            onSelect={setSelectedId}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected && <TerminalTitleBar session={selected} onOpen={() => data.openSession(selected)} />}
            <SessionTerminalView
              lines={lines}
              cursor={terminalCursorLabel(working, !!selected?.active)}
              working={working}
              loading={loading}
              error={error}
              emptyLabel="No transcript recorded for this session yet."
            />
          </div>
        </div>
      )}
    </div>
  )
}

function TerminalTabList({
  tabs,
  selectedId,
  onSelect,
}: {
  tabs: DashboardSession[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="CLI session terminals"
      aria-orientation="vertical"
      className="flex shrink-0 gap-px overflow-x-auto border-b border-border/50 bg-secondary/20 p-1.5 lg:w-64 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r"
    >
      {tabs.map((tab) => {
        const id = terminalTabId(tab)
        const selected = id === selectedId
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            className={`flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-2xs transition-smooth lg:w-full ${
              selected ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${tab.active ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`}
            />
            <EngineLogoForText text={normalizeCliKind(tab.kind)} size={12} decorative />
            <span className="truncate">{tabTitle(tab)}</span>
          </button>
        )
      })}
    </div>
  )
}

function TerminalTitleBar({ session, onOpen }: { session: DashboardSession; onOpen: () => void }) {
  const dir = workingDirLeaf(session.workingDir)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-secondary/20 px-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{tabTitle(session)}</p>
        <p className="truncate font-mono-tight text-2xs text-muted-foreground">
          {cliKindLabel(normalizeCliKind(session.kind))}
          {dir ? ` · ${dir}` : ''}
          {session.model ? ` · ${session.model}` : ''}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        Open
      </Button>
    </div>
  )
}

function tabTitle(session: DashboardSession): string {
  return sessionTitle({
    customTitle: session.title,
    lastUserPrompt: session.lastUserPrompt,
    kind: normalizeCliKind(session.kind),
    id: session.id,
  })
}
