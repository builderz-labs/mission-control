'use client'

// Represents a single live gateway session as a clickable pill.
// Purely presentational — selection state is owned by the parent.

import type { Session } from '@/store'

interface SessionChipProps {
  readonly session: Session
  readonly selected?: boolean
  readonly onClick?: () => void
}

export function SessionChip({ session, selected, onClick }: SessionChipProps): React.ReactElement {
  const ringClass = selected
    ? 'ring-1 ring-primary bg-primary/10 border-primary/40 text-primary'
    : session.active
      ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300 hover:border-emerald-500/50'
      : 'bg-surface-1 border-border/50 text-muted-foreground/60 hover:border-border'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] border transition-all cursor-pointer ${ringClass}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          session.active ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'
        }`}
      />
      <span className="font-medium">{session.kind}</span>
      <span className="text-muted-foreground/40">{session.model}</span>
      <span className="text-muted-foreground/30">{session.age}</span>
      {session.tokens && (
        <span className="text-muted-foreground/30">{session.tokens} tok</span>
      )}
    </button>
  )
}
