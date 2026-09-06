'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const NEAR_BOTTOM_PX = 32

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
}: {
  lines: TerminalLine[]
  cursor: string
  working: boolean
  loading: boolean
  error: string | null
  emptyLabel: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || !following) return
    node.scrollTop = node.scrollHeight
  }, [lines, cursor, following])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight
      setFollowing(distance <= NEAR_BOTTOM_PX)
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="relative flex-1 min-h-0 bg-[hsl(222_47%_4%)]">
      <div
        ref={scrollRef}
        role="log"
        aria-label="Session terminal output"
        aria-busy={loading || undefined}
        tabIndex={0}
        className="h-full overflow-y-auto overflow-x-auto px-4 py-3 font-mono-tight text-2xs leading-[1.55] focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary/60"
      >
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : lines.length === 0 ? (
          <p className="text-slate-500">{loading ? 'Reading session…' : emptyLabel}</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`whitespace-pre ${LINE_CLASS[line.kind]}`}>
              {line.text || ' '}
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
          onClick={() => setFollowing(true)}
          className="absolute bottom-3 right-4 rounded-full bg-primary/90 px-3 py-1 text-2xs font-medium text-primary-foreground shadow-lg"
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}
