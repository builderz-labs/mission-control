'use client'

import { useTranslations } from 'next-intl'

interface AlertRulesStatsProps {
  totalRules: number
  enabledCount: number
  totalTriggers: number
}

export function AlertRulesStats({ totalRules, enabledCount, totalTriggers }: AlertRulesStatsProps): React.JSX.Element {
  const t = useTranslations('alertRules')

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="text-2xs text-muted-foreground">{t('statTotalRules')}</div>
        <div className="text-xl font-bold text-foreground mt-0.5">{totalRules}</div>
      </div>
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="text-2xs text-muted-foreground">{t('statActive')}</div>
        <div className="text-xl font-bold text-green-400 mt-0.5">{enabledCount}</div>
      </div>
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="text-2xs text-muted-foreground">{t('statTotalTriggers')}</div>
        <div className="text-xl font-bold text-amber-400 mt-0.5">{totalTriggers}</div>
      </div>
    </div>
  )
}
