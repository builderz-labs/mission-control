'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type EvalResult } from './types'

interface EvalResultsPanelProps {
  results: EvalResult[]
  onDismiss: () => void
}

export function EvalResultsPanel({ results, onDismiss }: EvalResultsPanelProps): React.JSX.Element {
  const t = useTranslations('alertRules')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t('evalResultsTitle')}</h3>
        <Button onClick={onDismiss} variant="ghost" size="xs">
          {t('dismiss')}
        </Button>
      </div>
      <div className="space-y-1.5">
        {results.map(r => (
          <div
            key={r.rule_id}
            className={`flex items-center justify-between py-1.5 px-3 rounded-md text-xs ${
              r.triggered ? 'bg-red-500/10 border border-red-500/20' : 'bg-secondary/50'
            }`}
          >
            <span className="font-medium text-foreground">{r.rule_name}</span>
            <span className={r.triggered ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
              {r.triggered ? t('triggered') : r.reason}
            </span>
          </div>
        ))}
        {results.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-2">{t('noRulesToEvaluate')}</div>
        )}
      </div>
    </div>
  )
}
