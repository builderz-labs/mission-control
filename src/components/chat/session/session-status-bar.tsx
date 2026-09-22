'use client'

import { ContextWindowBar } from './context-window-bar'

export function SessionStatusBar({
  tokens,
  duration,
  percent,
  status,
  live = false,
}: {
  tokens?: string
  duration?: string
  percent?: number | null
  status?: string
  live?: boolean
}) {
  if (percent == null && !duration && !tokens && !status && !live) return null
  return (
    <div
      className={`relative flex items-center gap-3 px-6 pb-2 pt-1 text-[12px] text-[var(--chat-muted)] ${
        live ? 'chat-glimmer-line' : ''
      }`}
      aria-live={live ? 'polite' : undefined}
    >
      <ContextWindowBar percent={percent} tokens={tokens} duration={duration} />
      {status ? <span className="shrink-0">{status}</span> : null}
    </div>
  )
}
