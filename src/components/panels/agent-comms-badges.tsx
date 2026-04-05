'use client'

// Small status badge components for the AgentCommsPanel header.
// Purely presentational — no state, no side effects.

import { useTranslations } from 'next-intl'

interface ConnectionBadgeProps {
  // sseConnected is optional in ConnectionStatus — must accept undefined
  readonly connection: { readonly isConnected: boolean; readonly sseConnected?: boolean }
}

export function ConnectionBadge({ connection }: ConnectionBadgeProps): React.ReactElement {
  const t = useTranslations('agentComms')
  const cls = connection.isConnected
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : connection.sseConnected
      ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
      : 'bg-muted text-muted-foreground border-border/40'
  const label = connection.isConnected
    ? t('connectionGateway')
    : connection.sseConnected
      ? t('connectionSse')
      : t('connectionPolling')
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}

interface SourceBadgeProps {
  readonly sourceMode: 'seeded' | 'live' | 'mixed' | 'empty'
  // Accepts any translate function signature — the parent binds it from useTranslations
  readonly t: (key: string) => string
}

export function SourceBadge({ sourceMode, t }: SourceBadgeProps): React.ReactElement {
  const cls = sourceMode === 'live'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : sourceMode === 'mixed'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
  const label = sourceMode === 'live' ? t('sourceLive') : sourceMode === 'mixed' ? t('sourceMixed') : t('sourceSeeded')
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}
