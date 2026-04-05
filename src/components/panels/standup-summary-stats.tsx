'use client'

import { useTranslations } from 'next-intl'
import type { StandupSummary } from './standup-types'

interface StandupSummaryStatsProps {
  readonly summary: StandupSummary
}

export function StandupSummaryStats({ summary }: StandupSummaryStatsProps): React.ReactElement {
  const t = useTranslations('standup')

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-card rounded-lg p-4 border border-border text-center">
        <div className="text-2xl font-bold text-foreground">{summary.totalCompleted}</div>
        <div className="text-sm text-green-400">{t('statCompleted')}</div>
      </div>
      <div className="bg-card rounded-lg p-4 border border-border text-center">
        <div className="text-2xl font-bold text-foreground">{summary.totalInProgress}</div>
        <div className="text-sm text-yellow-400">{t('statInProgress')}</div>
      </div>
      <div className="bg-card rounded-lg p-4 border border-border text-center">
        <div className="text-2xl font-bold text-foreground">{summary.totalBlocked}</div>
        <div className="text-sm text-red-400">{t('statBlocked')}</div>
      </div>
      <div className="bg-card rounded-lg p-4 border border-border text-center">
        <div className="text-2xl font-bold text-foreground">{summary.overdue}</div>
        <div className="text-sm text-orange-400">{t('statOverdue')}</div>
      </div>
    </div>
  )
}
