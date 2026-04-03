'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { TIMEZONE_OPTIONS } from './constants'
import type { DashboardView, TimezoneOption } from './types'

interface DashboardHeaderProps {
  readonly view: DashboardView
  readonly selectedTimeframe: 'hour' | 'day' | 'week' | 'month'
  readonly selectedTimezone: TimezoneOption
  readonly availableModels: string[]
  readonly availableSessions: string[]
  readonly modelFilters: Set<string>
  readonly sessionFilters: Set<string>
  readonly sessionLabels: Record<string, string>
  readonly onViewChange: (view: DashboardView) => void
  readonly onTimeframeChange: (tf: 'hour' | 'day' | 'week' | 'month') => void
  readonly onTimezoneChange: (tz: TimezoneOption) => void
  readonly onToggleModelFilter: (model: string) => void
  readonly onToggleSessionFilter: (sessionId: string) => void
  readonly onClearAllFilters: () => void
}

export function DashboardHeader({
  view, selectedTimeframe, selectedTimezone,
  availableModels, availableSessions, modelFilters, sessionFilters, sessionLabels,
  onViewChange, onTimeframeChange, onTimezoneChange,
  onToggleModelFilter, onToggleSessionFilter, onClearAllFilters,
}: DashboardHeaderProps): JSX.Element {
  const hasActiveFilters = modelFilters.size > 0 || sessionFilters.size > 0

  return (
    <div className="border-b border-border pb-4 space-y-4">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Token &amp; Cost Dashboard</h1>
          <p className="text-muted-foreground mt-2">Monitor token usage and costs across models and sessions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['overview', 'sessions'] as DashboardView[]).map(v => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                  view === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex space-x-2">
            {(['hour', 'day', 'week', 'month'] as const).map(tf => (
              <Button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                variant={selectedTimeframe === tf ? 'default' : 'secondary'}
              >
                {tf.charAt(0).toUpperCase() + tf.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter chips — only in overview */}
      {view === 'overview' && (availableModels.length > 0 || availableSessions.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Filters:</span>
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
              {model.split('/').pop() || model}
              {modelFilters.has(model) && <span className="ml-0.5">x</span>}
            </button>
          ))}
          {availableSessions.length > 0 && availableModels.length > 0 && <span className="text-border">|</span>}
          {availableSessions.slice(0, 8).map(sessionId => (
            <button
              key={`session-${sessionId}`}
              onClick={() => onToggleSessionFilter(sessionId)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                sessionFilters.has(sessionId)
                  ? 'bg-blue-500/30 text-blue-300 border-blue-500/50'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
            >
              {sessionLabels[sessionId] || sessionId.split(':')[0] || sessionId}
              {sessionFilters.has(sessionId) && <span className="ml-0.5">x</span>}
            </button>
          ))}
          {hasActiveFilters && (
            <button
              onClick={onClearAllFilters}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Timezone selector — only in overview */}
      {view === 'overview' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Timezone:</span>
          <select
            value={selectedTimezone.label}
            onChange={e => {
              const tz = TIMEZONE_OPTIONS.find(t => t.label === e.target.value)
              if (tz) onTimezoneChange(tz)
            }}
            className="bg-card border border-border rounded px-2 py-1 text-xs text-foreground"
          >
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz.label} value={tz.label}>{tz.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
