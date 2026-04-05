'use client'

// Displayed when the filtered feed has no events.
// Purely presentational — no state, no side effects.

import { useTranslations } from 'next-intl'
import type { FeedFilter } from './agent-comms-panel-types'

interface EmptyStateProps {
  readonly filter: FeedFilter
}

export function EmptyState({ filter }: EmptyStateProps): React.ReactElement {
  const t = useTranslations('agentComms')

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-3">📡</div>
      <p className="text-sm font-medium text-muted-foreground">
        {filter === 'all' ? t('noFeedEvents') : t('noFilterEvents', { filter })}
      </p>
      <p className="text-xs text-muted-foreground/50 mt-1 max-w-[320px]">
        {filter === 'all'
          ? t('noFeedEventsHint')
          : t('noFilterEventsHint', { filter })}
      </p>
    </div>
  )
}
