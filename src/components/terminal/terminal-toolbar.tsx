'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface TerminalToolbarProps {
  sessionId: string
  sessionKind: string
  sessionName?: string
  isActive?: boolean
  mode: 'readonly' | 'interactive'
  viewMode: 'terminal' | 'transcript'
  onModeChange: (mode: 'readonly' | 'interactive') => void
  onViewModeChange: (mode: 'terminal' | 'transcript') => void
  onDetach?: () => void
}

export function TerminalToolbar({
  sessionId,
  sessionKind,
  sessionName,
  isActive,
  mode,
  viewMode,
  onModeChange,
  onViewModeChange,
  onDetach,
}: TerminalToolbarProps) {
  const [confirmingInteractive, setConfirmingInteractive] = useState(false)

  const kindLabel = sessionKind === 'claude-code' ? 'Claude' : sessionKind === 'codex-cli' ? 'Codex' : sessionKind
  const shortId = sessionId.length > 12 ? sessionId.slice(0, 8) + '...' : sessionId

  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-card/80 border-b border-border/50 shrink-0">
      {/* Left: Session info */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`size-2 rounded-full shrink-0 ${isActive ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
        <span className="text-xs font-medium text-foreground truncate">
          {sessionName || kindLabel}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">{shortId}</span>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* View mode toggle */}
        <div className="flex rounded-md border border-border/50 overflow-hidden">
          <button
            type="button"
            onClick={() => onViewModeChange('terminal')}
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
              viewMode === 'terminal'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Terminal
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('transcript')}
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-border/50 ${
              viewMode === 'transcript'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Transcript
          </button>
        </div>

        {/* Mode toggle (only in terminal view) */}
        {viewMode === 'terminal' && (
          <>
            {confirmingInteractive ? (
              <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-0.5">
                <span className="text-[10px] text-amber-400">Enable interactive?</span>
                <button
                  type="button"
                  onClick={() => {
                    onModeChange('interactive')
                    setConfirmingInteractive(false)
                  }}
                  className="text-[10px] text-green-400 hover:text-green-300 font-medium"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingInteractive(false)}
                  className="text-[10px] text-muted-foreground hover:text-foreground font-medium"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (mode === 'interactive') {
                    onModeChange('readonly')
                  } else {
                    setConfirmingInteractive(true)
                  }
                }}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                  mode === 'interactive'
                    ? 'bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25'
                    : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/25 hover:bg-zinc-500/25'
                }`}
              >
                {mode === 'interactive' ? 'RW' : 'RO'}
              </button>
            )}
          </>
        )}

        {/* Detach */}
        {onDetach && (
          <Button variant="ghost" size="icon-sm" onClick={onDetach} className="text-muted-foreground hover:text-foreground size-5">
            <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  )
}
