'use client'

import { useTranslations } from 'next-intl'
import { TimezoneOption, TIMEZONE_OPTIONS, getModelDisplayName } from './token-dashboard-types'

interface Session {
  id: string
  key?: string
  active?: boolean
  kind?: string
}

interface TokenFiltersProps {
  availableModels: string[]
  availableSessions: string[]
  sessions: Session[]
  modelFilters: Set<string>
  sessionFilters: Set<string>
  hasActiveFilters: boolean
  selectedTimezone: TimezoneOption
  onToggleModelFilter: (model: string) => void
  onToggleSessionFilter: (sessionId: string) => void
  onClearAllFilters: () => void
  onTimezoneChange: (tz: TimezoneOption) => void
}

export function TokenFilters({
  availableModels,
  availableSessions,
  sessions,
  modelFilters,
  sessionFilters,
  hasActiveFilters,
  selectedTimezone,
  onToggleModelFilter,
  onToggleSessionFilter,
  onClearAllFilters,
  onTimezoneChange,
}: TokenFiltersProps): React.JSX.Element {
  const t = useTranslations('tokenDashboard')

  return (
    <>
      {/* Filter Chips Bar */}
      {(availableModels.length > 0 || availableSessions.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">{t('filtersLabel')}</span>
          {availableModels.map(model => (
            <button
              key={`model-${model}`}
              onClick={() => onToggleModelFilter(model)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                modelFilters.has(model)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
            >
              {getModelDisplayName(model)}
              {modelFilters.has(model) && <span className="ml-0.5">x</span>}
            </button>
          ))}
          {availableSessions.length > 0 && availableModels.length > 0 && (
            <span className="text-border">|</span>
          )}
          {availableSessions.slice(0, 8).map(sessionId => {
            const info = sessions.find(s => s.id === sessionId)
            const label = info?.key || sessionId.split(':')[0] || sessionId
            return (
              <button
                key={`session-${sessionId}`}
                onClick={() => onToggleSessionFilter(sessionId)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  sessionFilters.has(sessionId)
                    ? 'bg-blue-500/30 text-blue-300 border-blue-500/50'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {label}
                {sessionFilters.has(sessionId) && <span className="ml-0.5">x</span>}
              </button>
            )
          })}
          {hasActiveFilters && (
            <button
              onClick={onClearAllFilters}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      )}

      {/* Timezone Selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('timezoneLabel')}</span>
        <select
          value={selectedTimezone.label}
          onChange={(e) => {
            const tz = TIMEZONE_OPTIONS.find(opt => opt.label === e.target.value)
            if (tz) onTimezoneChange(tz)
          }}
          className="bg-card border border-border rounded px-2 py-1 text-xs text-foreground"
        >
          {TIMEZONE_OPTIONS.map(tz => (
            <option key={tz.label} value={tz.label}>{tz.label}</option>
          ))}
        </select>
      </div>
    </>
  )
}
