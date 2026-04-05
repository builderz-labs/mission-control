'use client'

// Single event row rendered in TUI/IRC style.
// Purely presentational — no state, no side effects.

import { CATEGORY_META } from './agent-comms-panel-types'
import { formatTs, getIdentity } from './agent-comms-panel-utils'
import type { FeedEvent } from './agent-comms-panel-types'

interface FeedLineProps {
  readonly event: FeedEvent
}

export function FeedLine({ event }: FeedLineProps): React.ReactElement {
  const cat = CATEGORY_META[event.category]
  const identity = getIdentity(event.source)

  const levelColor =
    event.level === 'error' ? 'text-red-400'
    : event.level === 'warn' ? 'text-amber-400'
    : ''

  return (
    <div
      className={`group flex items-start gap-2 px-2 py-0.5 rounded hover:bg-surface-1/50 transition-colors ${levelColor}`}
    >
      {/* Timestamp — tabular so the column stays aligned */}
      <span className="text-[10px] text-muted-foreground/40 tabular-nums flex-shrink-0 pt-[2px]">
        {formatTs(event.ts)}
      </span>

      {/* Category tag */}
      <span
        className="text-[9px] px-1.5 py-px rounded-full flex-shrink-0 mt-[2px]"
        style={{ backgroundColor: `${cat.color}18`, color: cat.color }}
      >
        {cat.label}
      </span>

      {/* Source agent */}
      <span
        className="text-[11px] font-semibold flex-shrink-0"
        style={{ color: identity.color }}
      >
        {identity.label}
      </span>

      {/* Message body */}
      <span className="text-[12px] text-foreground/80 break-words min-w-0">
        {event.message}
      </span>
    </div>
  )
}
