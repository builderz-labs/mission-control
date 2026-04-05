'use client'

import { useTranslations } from 'next-intl'
import type { StandupHistory } from './standup-types'
import { formatDisplayDate } from './standup-types'

// WHY: History view has entirely different data requirements from the current-day
//      view; keeping it separate avoids prop-drilling and conditional rendering
//      bloat in the parent.

interface StandupHistoryViewProps {
  readonly history: StandupHistory[]
}

function HistoryEmptyState(): React.ReactElement {
  const t = useTranslations('standup')
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-2">
        <rect x="3" y="2" width="10" height="12" rx="1" />
        <path d="M6 5h4M6 8h4M6 11h2" />
      </svg>
      <p className="text-sm">{t('noHistory')}</p>
    </div>
  )
}

interface HistoryCardProps {
  readonly item: StandupHistory
}

function HistoryCard({ item }: HistoryCardProps): React.ReactElement {
  const t = useTranslations('standup')
  return (
    <div className="bg-card rounded-lg p-4 border border-border hover:bg-surface-1 transition-smooth">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="text-foreground font-medium">{formatDisplayDate(item.date)}</h4>
          <p className="text-muted-foreground text-sm">
            {t('historyGenerated', { date: new Date(item.generatedAt).toLocaleString() })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('historyAgentsParticipated', { count: item.agentCount })}
          </p>
        </div>
        {item.summary && (
          <div className="text-right text-sm text-muted-foreground">
            <div>{t('historyCompleted', { count: item.summary.completed ?? 0 })}</div>
            <div>{t('historyInProgress', { count: item.summary.inProgress ?? 0 })}</div>
            <div>{t('historyBlocked', { count: item.summary.blocked ?? 0 })}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export function StandupHistoryView({ history }: StandupHistoryViewProps): React.ReactElement {
  if (history.length === 0) return <HistoryEmptyState />

  return (
    <div className="space-y-4">
      {history.map(item => (
        <HistoryCard key={item.id} item={item} />
      ))}
    </div>
  )
}
