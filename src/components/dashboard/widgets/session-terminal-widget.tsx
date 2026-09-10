'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import {
  TERMINAL_GRID_SNAPS,
  gridTerminalSessions,
  terminalGridClass,
  terminalGridColumns,
  type TerminalGridDensity,
} from '@/lib/terminal-grid'
import { terminalTabId } from '@/lib/terminal-sessions'
import type { DashboardData } from '../widget-primitives'
import { SessionTerminalCell } from './session-terminal-cell'

type TerminalWidgetData = Pick<
  DashboardData,
  'sessions' | 'isSessionsLoading' | 'openSession' | 'navigateToPanel'
>

/**
 * A terminal is a fixed viewport onto scrollback. Without a bounded height each
 * cell grows to its full transcript and the page scrolls instead, so the inner
 * scroller never overflows and auto-tail has nothing to follow.
 */
const CELL_HEIGHT = 'h-[17rem]'

/** The wall itself is bounded too, so twelve terminals cannot own the whole page. */
const WALL_FRAME = 'max-h-[46rem] overflow-y-auto p-3'

export function SessionTerminalWidget({ data }: { data: TerminalWidgetData }) {
  const [density, setDensity] = useState<TerminalGridDensity>('auto')
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const cells = useMemo(() => gridTerminalSessions(data.sessions), [data.sessions])
  const liveCount = useMemo(() => data.sessions.filter((s) => s.active).length, [data.sessions])
  const columns = terminalGridColumns(cells.length, density)

  return (
    <div className="panel flex flex-col">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">CLI Sessions — Terminals</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono-tight text-2xs text-muted-foreground">
            {liveCount} live · {data.sessions.length}
          </span>
          {cells.length > 1 && <GridSnapControl density={density} onChange={setDensity} />}
          <Button variant="outline" size="sm" onClick={() => data.navigateToPanel('sessions')}>
            All sessions
          </Button>
        </div>
      </div>

      {cells.length === 0 ? (
        <EmptyWall loading={data.isSessionsLoading} />
      ) : (
        <div className={WALL_FRAME}>
          {liveCount === 0 && (
            <p className="mb-2 text-2xs text-muted-foreground/70">
              Nothing is running right now — showing the most recent sessions.
            </p>
          )}
          <div className={`grid gap-3 ${terminalGridClass(columns)}`}>
            {cells.map((session) => {
              const id = terminalTabId(session)
              return (
                <div key={id} className={CELL_HEIGHT}>
                  <SessionTerminalCell
                    session={session}
                    focused={id === focusedId}
                    onFocus={() => setFocusedId(id)}
                    onOpen={() => data.openSession(session)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyWall({ loading }: { loading: boolean }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-xs text-muted-foreground">{loading ? 'Loading sessions…' : 'No CLI sessions'}</p>
      <p className="mt-1 text-2xs text-muted-foreground/60">
        Start a Claude, Codex, Grok, Kimi, Hermes, or OpenCode session to see its terminal here.
      </p>
    </div>
  )
}

/**
 * Fixed column snaps rather than free resizing, the way VS Code offers a short
 * list of editor layouts instead of asking the operator to drag every split.
 */
function GridSnapControl({
  density,
  onChange,
}: {
  density: TerminalGridDensity
  onChange: (next: TerminalGridDensity) => void
}) {
  const options: { value: TerminalGridDensity; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    ...TERMINAL_GRID_SNAPS.map((snap) => ({ value: snap as TerminalGridDensity, label: String(snap) })),
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Terminal grid columns"
      className="flex items-center gap-px rounded-md border border-border/60 bg-secondary/30 p-0.5"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={density === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-1.5 py-0.5 text-2xs transition-smooth ${
            density === option.value
              ? 'bg-primary/20 text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
