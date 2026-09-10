'use client'

import { useRef } from 'react'
import { useTailScroll } from '@/lib/use-tail-scroll'
import type { TerminalLine, TerminalLineKind } from '@/lib/terminal-transcript'

const LINE_CLASS: Record<TerminalLineKind, string> = {
  prompt: 'text-emerald-300',
  command: 'text-cyan-300',
  result: 'text-slate-400',
  error: 'text-red-400',
  thinking: 'text-violet-400/70 italic',
  meta: 'text-slate-500',
  output: 'text-slate-200',
}

/**
 * Terminal scrollback surface. Follows the tail like an integrated terminal
 * does, but stops following the moment the operator scrolls up to read.
 */
export function SessionTerminalView({
  lines,
  cursor,
  working,
  loading,
  error,
  emptyLabel,
  sessionKey,
  compact = false,
}: {
  lines: TerminalLine[]
  cursor: string
  working: boolean
  loading: boolean
  error: string | null
  emptyLabel: string
  /** Identifies the session, so switching panes re-pins to its newest line. */
  sessionKey?: string | null
  compact?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { following, jumpToLatest } = useTailScroll(scrollRef, {
    key: sessionKey,
    count: lines.length,
  })

  return (
    <div className="relative flex-1 min-h-0 min-w-0 bg-[hsl(222_47%_4%)]">
      <div
        ref={scrollRef}
        role="log"
        aria-label="Session terminal output"
        aria-busy={loading || undefined}
        tabIndex={0}
        className={`h-full overflow-y-auto overflow-x-auto font-mono-tight text-2xs leading-[1.55] focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary/60 ${
          compact ? 'px-3 py-2' : 'px-4 py-3'
        }`}
      >
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : lines.length === 0 ? (
          <p className="text-slate-500">{loading ? 'Reading session…' : emptyLabel}</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`whitespace-pre ${LINE_CLASS[line.kind]}`}>
              {line.text || ' '}
            </div>
          ))
        )}
        {!error && (
          <div className="whitespace-pre text-emerald-300">
            {cursor}
            <span
              aria-hidden="true"
              className={`ml-px inline-block h-3 w-[7px] translate-y-[2px] bg-emerald-300 ${working ? 'animate-pulse' : 'opacity-60'}`}
            />
          </div>
        )}
      </div>

      {!following && (
        <button
          type="button"
          onClick={jumpToLatest}
          className={`absolute rounded-full bg-primary/90 font-medium text-primary-foreground shadow-lg ${
            compact ? 'bottom-2 right-3 px-2 py-0.5 text-2xs' : 'bottom-3 right-4 px-3 py-1 text-2xs'
          }`}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}
