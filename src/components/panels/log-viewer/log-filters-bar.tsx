'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type LogFilters } from './types'

interface LogFiltersBarProps {
  logFilters: LogFilters
  availableSources: string[]
  isAutoScroll: boolean
  filteredCount: number
  onFilterChange: (filters: Partial<LogFilters>) => void
  onToggleAutoScroll: () => void
  onScrollToBottom: () => void
  onExportText: () => void
  onExportJson: () => void
  onClearLogs: () => void
}

export function LogFiltersBar({
  logFilters,
  availableSources,
  isAutoScroll,
  filteredCount,
  onFilterChange,
  onToggleAutoScroll,
  onScrollToBottom,
  onExportText,
  onExportJson,
  onClearLogs,
}: LogFiltersBarProps): React.JSX.Element {
  const t = useTranslations('logViewer')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {/* Level Filter */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            {t('filterLevel')}
          </label>
          <select
            value={logFilters.level || ''}
            onChange={(e) => onFilterChange({ level: e.target.value || undefined })}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">{t('allLevels')}</option>
            <option value="error">{t('levelError')}</option>
            <option value="warn">{t('levelWarning')}</option>
            <option value="info">{t('levelInfo')}</option>
            <option value="debug">{t('levelDebug')}</option>
          </select>
        </div>

        {/* Source Filter */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            {t('filterSource')}
          </label>
          <select
            value={logFilters.source || ''}
            onChange={(e) => onFilterChange({ source: e.target.value || undefined })}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">{t('allSources')}</option>
            {availableSources.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
        </div>

        {/* Session Filter */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            {t('filterSession')}
          </label>
          <input
            type="text"
            value={logFilters.session || ''}
            onChange={(e) => onFilterChange({ session: e.target.value || undefined })}
            placeholder={t('sessionPlaceholder')}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Search Filter */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            {t('filterSearch')}
          </label>
          <input
            type="text"
            value={logFilters.search || ''}
            onChange={(e) => onFilterChange({ search: e.target.value || undefined })}
            placeholder={t('searchPlaceholder')}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Scroll Controls */}
        <div className="flex items-end space-x-2">
          <Button
            onClick={onToggleAutoScroll}
            variant={isAutoScroll ? 'success' : 'outline'}
          >
            {isAutoScroll ? t('auto') : t('manual')}
          </Button>
          <Button
            onClick={onScrollToBottom}
            className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
          >
            {t('bottom')}
          </Button>
        </div>

        {/* Export & Clear */}
        <div className="flex items-end space-x-2">
          <Button
            onClick={onExportText}
            disabled={filteredCount === 0}
            className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            {t('exportLog')}
          </Button>
          <Button
            onClick={onExportJson}
            disabled={filteredCount === 0}
            className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            {t('exportJson')}
          </Button>
          <Button onClick={onClearLogs} variant="destructive">
            {t('clear')}
          </Button>
        </div>
      </div>
    </div>
  )
}
