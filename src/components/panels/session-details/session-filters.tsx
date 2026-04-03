'use client'

import type { JSX } from 'react'
import type { SessionFilter, SortBy, TimeWindow } from './types'

const SELECT_CLASS =
  'px-2 py-1 border border-border rounded bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50'

interface SessionFiltersProps {
  sessionFilter: SessionFilter
  onSessionFilterChange: (value: SessionFilter) => void
  sortBy: SortBy
  onSortByChange: (value: SortBy) => void
  timeWindow: TimeWindow
  onTimeWindowChange: (value: TimeWindow) => void
  includeGlobal: boolean
  onIncludeGlobalChange: (value: boolean) => void
  includeUnknown: boolean
  onIncludeUnknownChange: (value: boolean) => void
  filteredCount: number
  totalCount: number
  activeCount: number
}

export function SessionFilters({
  sessionFilter,
  onSessionFilterChange,
  sortBy,
  onSortByChange,
  timeWindow,
  onTimeWindowChange,
  includeGlobal,
  onIncludeGlobalChange,
  includeUnknown,
  onIncludeUnknownChange,
  filteredCount,
  totalCount,
  activeCount,
}: SessionFiltersProps): JSX.Element {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Filter</label>
          <select
            value={sessionFilter}
            onChange={(e) => onSessionFilterChange(e.target.value as SessionFilter)}
            className={SELECT_CLASS}
          >
            <option value="all">All Sessions</option>
            <option value="active">Active Only</option>
            <option value="idle">Idle Only</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Sort by</label>
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortBy)}
            className={SELECT_CLASS}
          >
            <option value="age">Age</option>
            <option value="tokens">Token Usage</option>
            <option value="model">Model</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Time Window</label>
          <select
            value={timeWindow}
            onChange={(e) => onTimeWindowChange(e.target.value as TimeWindow)}
            className={SELECT_CLASS}
          >
            <option value="1h">Last 1h</option>
            <option value="6h">Last 6h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="all">All</option>
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer pb-0.5">
          <input
            type="checkbox"
            checked={includeGlobal}
            onChange={(e) => onIncludeGlobalChange(e.target.checked)}
            className="accent-primary"
          />
          Global
        </label>

        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer pb-0.5">
          <input
            type="checkbox"
            checked={includeUnknown}
            onChange={(e) => onIncludeUnknownChange(e.target.checked)}
            className="accent-primary"
          />
          Unknown
        </label>

        <div className="ml-auto text-sm text-muted-foreground pb-0.5">
          {filteredCount} of {totalCount} sessions{' '}
          • {activeCount} active
        </div>
      </div>
    </div>
  )
}
