'use client'

import { useTranslations } from 'next-intl'
import { contextPercent } from '@/lib/chat-session-metrics'

export function ContextWindowBar({
  percent,
  tokens,
  model,
  duration,
  compact = false,
}: {
  percent?: number | null
  tokens?: string
  model?: string
  duration?: string
  compact?: boolean
}) {
  const t = useTranslations('chatDesktop')
  const value = percent ?? contextPercent(tokens, model)
  if (value == null && !tokens && !duration) return null
  const hot = (value ?? 0) >= 85
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--chat-muted)]">
      {value != null && (
        <div
          className={`${compact ? 'h-0.5 w-8' : 'h-1 w-16'} overflow-hidden rounded-full bg-white/10`}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value)}
          aria-label={t('contextWindow', { percent: Math.round(value) })}
        >
          <div
            className={`h-full rounded-full ${hot ? 'bg-[var(--chat-accent)]' : 'bg-white/70'}`}
            style={{ width: `${value}%` }}
          />
        </div>
      )}
      {tokens ? <span className="truncate">{compact ? tokens : t('tokensUsed', { tokens })}</span> : null}
      {duration ? <span className="shrink-0">{compact ? duration : t('timeSpent', { time: duration })}</span> : null}
    </div>
  )
}
