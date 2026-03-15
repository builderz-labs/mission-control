'use client'

import type { CalendarViewMode } from './types'

interface FilterControlsProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  agentFilter: string
  onAgentFilterChange: (value: string) => void
  stateFilter: 'all' | 'enabled' | 'disabled'
  onStateFilterChange: (value: 'all' | 'enabled' | 'disabled') => void
  uniqueAgents: string[]
  calendarView: CalendarViewMode
  onCalendarViewChange: (mode: CalendarViewMode) => void
}

export function FilterControls({
  searchQuery,
  onSearchChange,
  agentFilter,
  onAgentFilterChange,
  stateFilter,
  onStateFilterChange,
  uniqueAgents,
  calendarView,
  onCalendarViewChange,
}: FilterControlsProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(['agenda', 'day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => onCalendarViewChange(mode)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              calendarView === mode
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            {mode === 'agenda' ? 'Agenda' : mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search jobs, agents, models..."
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
        />
        <select
          value={agentFilter}
          onChange={(e) => onAgentFilterChange(e.target.value)}
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
        >
          <option value="all">All Agents</option>
          {uniqueAgents.map((agentId) => (
            <option key={agentId} value={agentId}>
              {agentId}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => onStateFilterChange(e.target.value as 'all' | 'enabled' | 'disabled')}
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
        >
          <option value="all">All States</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
    </>
  )
}
