'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import type { HealthReport } from './types'
import { statusColor, statusBg } from './utils'

interface HealthViewProps {
  report: HealthReport | null
  isLoading: boolean
  onRefresh: () => void
}

export function HealthView({ report, isLoading, onRefresh }: HealthViewProps) {
  const t = useTranslations('memoryBrowser')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader variant="inline" label={t('runningDiagnostics')} />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
        <span className="text-sm font-mono mb-3">{t('noHealthData')}</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('runDiagnostics')}</Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-bold font-mono tabular-nums ${statusColor(report.overall)}`}>{report.overallScore}</div>
        <div>
          <div className={`text-sm font-semibold font-mono uppercase ${statusColor(report.overall)}`}>{report.overall}</div>
          <div className="text-[11px] text-muted-foreground/50 font-mono">{t('healthCategories', { time: new Date(report.generatedAt).toLocaleTimeString() })}</div>
        </div>
        <div className="flex-1" />
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>
      <div className="grid gap-3">
        {report.categories.map((cat) => (
          <div key={cat.name} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-lg font-bold font-mono tabular-nums ${statusColor(cat.status)}`}>{cat.score}</span>
              <span className="text-sm font-mono text-foreground flex-1">{cat.name}</span>
              <span className={`text-[10px] font-mono uppercase ${statusColor(cat.status)}`}>{cat.status}</span>
            </div>
            <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full transition-all ${statusBg(cat.status)}`} style={{ width: `${cat.score}%`, opacity: 0.7 }} />
            </div>
            {cat.issues.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {cat.issues.map((issue, i) => <div key={i} className="text-[11px] font-mono text-muted-foreground/70">- {issue}</div>)}
              </div>
            )}
            {cat.suggestions.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {cat.suggestions.map((sug, i) => <div key={i} className="text-[11px] font-mono text-primary/50">{sug}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
