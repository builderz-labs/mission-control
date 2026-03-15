'use client'

import type { CronJob } from '@/store'
import type {
  CalendarViewMode,
  CalendarOccurrence,
  DayJobEntry,
  DayWithJobs,
} from './types'
import { startOfDay, isSameDay } from './types'
import { FilterControls } from './filter-controls'

interface CalendarViewProps {
  isLocalMode: boolean
  calendarView: CalendarViewMode
  calendarRangeLabel: string
  calendarOccurrences: CalendarOccurrence[]
  dayJobs: DayJobEntry[]
  jobsByWeekDay: DayWithJobs[]
  jobsByMonthDay: DayWithJobs[]
  selectedDayJobs: DayJobEntry[]
  selectedCalendarDate: Date
  calendarDate: Date
  searchQuery: string
  agentFilter: string
  stateFilter: 'all' | 'enabled' | 'disabled'
  uniqueAgents: string[]
  onJobSelect: (job: CronJob) => void
  onMoveCalendar: (direction: -1 | 1) => void
  onSetCalendarDate: (date: Date) => void
  onSetSelectedCalendarDate: (date: Date) => void
  onSetCalendarView: (mode: CalendarViewMode) => void
  onSearchChange: (value: string) => void
  onAgentFilterChange: (value: string) => void
  onStateFilterChange: (value: 'all' | 'enabled' | 'disabled') => void
}

export function CalendarView({
  isLocalMode,
  calendarView,
  calendarRangeLabel,
  calendarOccurrences,
  dayJobs,
  jobsByWeekDay,
  jobsByMonthDay,
  selectedDayJobs,
  selectedCalendarDate,
  calendarDate,
  searchQuery,
  agentFilter,
  stateFilter,
  uniqueAgents,
  onJobSelect,
  onMoveCalendar,
  onSetCalendarDate,
  onSetSelectedCalendarDate,
  onSetCalendarView,
  onSearchChange,
  onAgentFilterChange,
  onStateFilterChange,
}: CalendarViewProps) {
  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Calendar View</h2>
            <p className="text-sm text-muted-foreground">
              {isLocalMode
                ? 'Read-only schedule visibility across local cron jobs and automations'
                : 'Interactive schedule across all matching cron jobs'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onMoveCalendar(-1)}
              className="px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => onSetCalendarDate(startOfDay(new Date()))}
              className="px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-sm"
            >
              Today
            </button>
            <button
              onClick={() => onMoveCalendar(1)}
              className="px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Next
            </button>
            <div className="text-sm font-medium text-foreground ml-1">{calendarRangeLabel}</div>
          </div>
        </div>

        <FilterControls
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          agentFilter={agentFilter}
          onAgentFilterChange={onAgentFilterChange}
          stateFilter={stateFilter}
          onStateFilterChange={onStateFilterChange}
          uniqueAgents={uniqueAgents}
          calendarView={calendarView}
          onCalendarViewChange={onSetCalendarView}
        />

        {calendarView === 'agenda' && (
          <AgendaView
            calendarOccurrences={calendarOccurrences}
            onJobSelect={onJobSelect}
          />
        )}

        {calendarView === 'day' && (
          <DayView dayJobs={dayJobs} onJobSelect={onJobSelect} />
        )}

        {calendarView === 'week' && (
          <WeekView
            jobsByWeekDay={jobsByWeekDay}
            selectedCalendarDate={selectedCalendarDate}
            onSetSelectedCalendarDate={onSetSelectedCalendarDate}
          />
        )}

        {calendarView === 'month' && (
          <MonthView
            jobsByMonthDay={jobsByMonthDay}
            selectedCalendarDate={selectedCalendarDate}
            calendarDate={calendarDate}
            onSetSelectedCalendarDate={onSetSelectedCalendarDate}
          />
        )}

        {calendarView !== 'agenda' && (
          <SelectedDayDetail
            selectedCalendarDate={selectedCalendarDate}
            selectedDayJobs={selectedDayJobs}
            onJobSelect={onJobSelect}
          />
        )}
      </div>
    </div>
  )
}

// --- Internal sub-views kept in the same file for cohesion ---

function AgendaView({
  calendarOccurrences,
  onJobSelect,
}: {
  calendarOccurrences: CalendarOccurrence[]
  onJobSelect: (job: CronJob) => void
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-y-auto divide-y divide-border">
        {calendarOccurrences.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No jobs match the current filters.</div>
        ) : (
          calendarOccurrences.map((row) => (
            <button
              key={`agenda-${row.job.id || row.job.name}-${row.atMs}`}
              onClick={() => onJobSelect(row.job)}
              className="w-full p-3 text-left flex flex-col md:flex-row md:items-center md:justify-between gap-2 hover:bg-secondary transition-colors"
            >
              <div>
                <div className="font-medium text-foreground">{row.job.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.job.agentId || 'system'} · {row.job.enabled ? 'enabled' : 'disabled'} · {row.job.schedule}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {new Date(row.atMs).toLocaleString()}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function DayView({
  dayJobs,
  onJobSelect,
}: {
  dayJobs: DayJobEntry[]
  onJobSelect: (job: CronJob) => void
}) {
  return (
    <div className="border border-border rounded-lg p-3">
      {dayJobs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No scheduled jobs for this day.</div>
      ) : (
        <div className="space-y-2">
          {dayJobs.map((row) => (
            <button
              key={`day-${row.job.id || row.job.name}-${row.atMs}`}
              onClick={() => onJobSelect(row.job)}
              className="w-full p-2 rounded border border-border bg-secondary/40 hover:bg-secondary transition-colors text-left"
            >
              <div className="text-sm font-medium text-foreground">{row.job.name}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(row.atMs).toLocaleTimeString()} · {row.job.agentId || 'system'} · {row.job.enabled ? 'enabled' : 'disabled'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function WeekView({
  jobsByWeekDay,
  selectedCalendarDate,
  onSetSelectedCalendarDate,
}: {
  jobsByWeekDay: DayWithJobs[]
  selectedCalendarDate: Date
  onSetSelectedCalendarDate: (date: Date) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {jobsByWeekDay.map(({ date, jobs }) => (
        <button
          key={`week-${date.toISOString()}`}
          onClick={() => onSetSelectedCalendarDate(startOfDay(date))}
          className={`border border-border rounded-lg p-2 min-h-36 text-left ${isSameDay(date, selectedCalendarDate) ? 'bg-primary/10 border-primary/40' : 'hover:bg-secondary/50'}`}
        >
          <div className={`text-xs font-medium mb-2 ${isSameDay(date, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
            {date.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })}
          </div>
          <div className="space-y-1">
            {jobs.slice(0, 4).map((row) => (
              <div key={`week-job-${row.job.id || row.job.name}-${row.atMs}`} className="text-xs px-2 py-1 rounded bg-secondary text-foreground truncate" title={row.job.name}>
                {new Date(row.atMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {row.job.name}
              </div>
            ))}
            {jobs.length > 4 && (
              <div className="text-xs text-muted-foreground">+{jobs.length - 4} more</div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

function MonthView({
  jobsByMonthDay,
  selectedCalendarDate,
  calendarDate,
  onSetSelectedCalendarDate,
}: {
  jobsByMonthDay: DayWithJobs[]
  selectedCalendarDate: Date
  calendarDate: Date
  onSetSelectedCalendarDate: (date: Date) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {jobsByMonthDay.map(({ date, jobs }) => {
        const inCurrentMonth = date.getMonth() === calendarDate.getMonth()
        return (
          <div
            key={`month-${date.toISOString()}`}
            onClick={() => onSetSelectedCalendarDate(startOfDay(date))}
            className={`border border-border rounded-lg p-2 min-h-24 cursor-pointer ${inCurrentMonth ? 'bg-transparent' : 'bg-secondary/30'} ${isSameDay(date, selectedCalendarDate) ? 'border-primary/40 bg-primary/10' : 'hover:bg-secondary/50'}`}
          >
            <div className={`text-xs mb-1 ${isSameDay(date, new Date()) ? 'text-primary font-semibold' : inCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
              {date.getDate()}
            </div>
            <div className="space-y-1">
              {jobs.slice(0, 2).map((row) => (
                <div key={`month-job-${row.job.id || row.job.name}-${row.atMs}`} className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-foreground truncate" title={row.job.name}>
                  {row.job.name}
                </div>
              ))}
              {jobs.length > 2 && <div className="text-[11px] text-muted-foreground">+{jobs.length - 2}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SelectedDayDetail({
  selectedCalendarDate,
  selectedDayJobs,
  onJobSelect,
}: {
  selectedCalendarDate: Date
  selectedDayJobs: DayJobEntry[]
  onJobSelect: (job: CronJob) => void
}) {
  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">
          {selectedCalendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
        </h3>
        <span className="text-xs text-muted-foreground">{selectedDayJobs.length} jobs</span>
      </div>
      {selectedDayJobs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No jobs scheduled on this date.</div>
      ) : (
        <div className="space-y-2">
          {selectedDayJobs.map((row) => (
            <button
              key={`selected-day-${row.job.id || row.job.name}-${row.atMs}`}
              onClick={() => onJobSelect(row.job)}
              className="w-full text-left p-2 rounded border border-border bg-secondary/40 hover:bg-secondary transition-colors"
            >
              <div className="text-sm font-medium text-foreground">{row.job.name}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(row.atMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {row.job.agentId || 'system'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
