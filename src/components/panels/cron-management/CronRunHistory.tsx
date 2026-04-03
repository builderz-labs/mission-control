'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CronJob } from '@/store'
import { RunHistoryEntry, getStatusBg, getStatusColor } from './cron-management-types'

interface CronRunHistoryProps {
  selectedJob: CronJob
  runHistory: RunHistoryEntry[]
  runHistoryTotal: number
  runHistoryHasMore: boolean
  runHistoryPage: number
  runHistoryQuery: string
  onClose: () => void
  onQueryChange: (query: string) => void
  onLoadMore: () => void
}

export function CronRunHistory({
  selectedJob,
  runHistory,
  runHistoryTotal,
  runHistoryHasMore,
  runHistoryPage,
  runHistoryQuery,
  onClose,
  onQueryChange,
  onLoadMore,
}: CronRunHistoryProps): React.JSX.Element {
  const t = useTranslations('cronManagement')

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t('runHistoryTitle', { name: selectedJob.name })}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('totalRuns', { count: runHistoryTotal })}
          </span>
          <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
            {t('close')}
          </Button>
        </div>
      </div>

      <div className="mb-3">
        <input
          value={runHistoryQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('filterRunsPlaceholder')}
          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">{t('colStatus')}</th>
              <th className="pb-2 pr-3 font-medium">{t('delivery')}</th>
              <th className="pb-2 pr-3 font-medium">{t('timestamp')}</th>
              <th className="pb-2 pr-3 font-medium">{t('duration')}</th>
              <th className="pb-2 font-medium">{t('error')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {runHistory.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">
                  {t('noRunHistoryAvailable')}
                </td>
              </tr>
            ) : (
              runHistory.map((entry, idx) => {
                const ts = entry.timestamp || entry.startedAtMs
                return (
                  <tr key={idx} className="hover:bg-secondary/50">
                    <td className="py-2 pr-3">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${getStatusBg(
                          entry.status
                        )} ${getStatusColor(entry.status)}`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {entry.deliveryStatus || '--'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                      {ts ? new Date(ts).toLocaleString() : '--'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '--'}
                    </td>
                    <td className="py-2 text-xs text-red-400 truncate max-w-64">
                      {entry.error || ''}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {runHistoryHasMore && (
        <div className="mt-3 text-center">
          <Button onClick={onLoadMore} variant="outline" size="sm">
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
