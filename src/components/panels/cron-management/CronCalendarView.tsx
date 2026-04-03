'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { buildDayKey, getCronOccurrences } from '@/lib/cron-occurrences'
import { describeCronFrequency } from '@/lib/cron-utils'
import {
  CronJob,
  DayJobSummary,
  CalendarViewMode,
  ScheduleKindFilter,
  SortField,
  SortDir,
  getAgentColorClass,
  isSameDay,
  startOfDay,
  addDays,
  getWeekStart,
  getMonthStartGrid,
  formatDateLabel,
} from './cron-management-types'

interface CronCalendarViewProps {
  filteredJobs: CronJob[]
  uniqueAgents: string[]
  calendarView: CalendarViewMode
  calendarDate: Date
  selectedCalendarDate: Date
  searchQuery: string
  agentFilter: string
  stateFilter: 'all' | 'enabled' | 'disabled'
  scheduleKindFilter: ScheduleKindFilter
  sortField: SortField
  sortDir: SortDir
  isLocalMode: boolean
  onJobSelect: (job: CronJob) => void
  onCalendarViewChange: (mode: CalendarViewMode) => void
  onCalendarDateChange: (date: Date) => void
  onSelectedCalendarDateChange: (date: Date) => void
  onSearchQueryChange: (q: string) => void
  onAgentFilterChange: (a: string) => void
  onStateFilterChange: (s: 'all' | 'enabled' | 'disabled') => void
  onScheduleKindFilterChange: (k: ScheduleKindFilter) => void
  onSortFieldChange: (f: SortField) => void
  onSortDirToggle: () => void
}

export function CronCalendarView({
  filteredJobs,
  uniqueAgents,
  calendarView,
  calendarDate,
  selectedCalendarDate,
  searchQuery,
  agentFilter,
  stateFilter,
  scheduleKindFilter,
  sortField,
  sortDir,
  isLocalMode,
  onJobSelect,
  onCalendarViewChange,
  onCalendarDateChange,
  onSelectedCalendarDateChange,
  onSearchQueryChange,
  onAgentFilterChange,
  onStateFilterChange,
  onScheduleKindFilterChange,
  onSortFieldChange,
  onSortDirToggle,
}: CronCalendarViewProps): React.JSX.Element {
  const t = useTranslations('cronManagement')

  const dayStart = startOfDay(calendarDate)
  const dayEnd = addDays(dayStart, 1)
  const weekStart = getWeekStart(calendarDate)
  const weekDays = Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx))
  const monthGridStart = getMonthStartGrid(calendarDate)
  const monthDays = Array.from({ length: 42 }, (_, idx) => addDays(monthGridStart, idx))

  const calendarBounds = useMemo(() => {
    if (calendarView === 'day') {
      return { startMs: dayStart.getTime(), endMs: dayEnd.getTime() }
    }
    if (calendarView === 'week') {
      return { startMs: weekStart.getTime(), endMs: addDays(weekStart, 7).getTime() }
    }
    if (calendarView === 'month') {
      return { startMs: monthGridStart.getTime(), endMs: addDays(monthGridStart, 42).getTime() }
    }
    const agendaStart = Date.now()
    return { startMs: agendaStart, endMs: addDays(startOfDay(new Date()), 30).getTime() }
  }, [calendarView, dayEnd, dayStart, monthGridStart, weekStart])

  const jobSummariesByDay = useMemo(() => {
    const dayMap = new Map<string, DayJobSummary[]>()
    for (const job of filteredJobs) {
      const occurrences = getCronOccurrences(job.schedule, calendarBounds.startMs, calendarBounds.endMs, 5000)

      if (occurrences.length === 0 && typeof job.nextRun === 'number' && job.nextRun >= calendarBounds.startMs && job.nextRun < calendarBounds.endMs) {
        occurrences.push({ atMs: job.nextRun, dayKey: buildDayKey(new Date(job.nextRun)) })
      }

      const perDay = new Map<string, { count: number; firstMs: number }>()
      for (const occ of occurrences) {
        const existing = perDay.get(occ.dayKey)
        if (existing) {
          existing.count++
          if (occ.atMs < existing.firstMs) existing.firstMs = occ.atMs
        } else {
          perDay.set(occ.dayKey, { count: 1, firstMs: occ.atMs })
        }
      }

      for (const [dayKey, { count, firstMs }] of perDay) {
        const existing = dayMap.get(dayKey) || []
        existing.push({ job, runCount: count, firstRunMs: firstMs })
        dayMap.set(dayKey, existing)
      }
    }

    for (const [, summaries] of dayMap) {
      summaries.sort((a, b) => a.firstRunMs - b.firstRunMs)
    }
    return dayMap
  }, [calendarBounds.endMs, calendarBounds.startMs, filteredJobs])

  const calendarOccurrences = useMemo(() => {
    if (calendarView !== 'agenda') return []
    const rows: Array<{ job: CronJob; atMs: number; dayKey: string }> = []
    for (const job of filteredJobs) {
      const occurrences = getCronOccurrences(job.schedule, calendarBounds.startMs, calendarBounds.endMs, 50)
      for (const occurrence of occurrences) {
        rows.push({ job, atMs: occurrence.atMs, dayKey: occurrence.dayKey })
      }
      if (occurrences.length === 0 && typeof job.nextRun === 'number' && job.nextRun >= calendarBounds.startMs && job.nextRun < calendarBounds.endMs) {
        rows.push({ job, atMs: job.nextRun, dayKey: buildDayKey(new Date(job.nextRun)) })
      }
    }
    rows.sort((a, b) => a.atMs - b.atMs)
    return rows.slice(0, 500)
  }, [calendarBounds.endMs, calendarBounds.startMs, calendarView, filteredJobs])

  const dayJobSummaries = jobSummariesByDay.get(buildDayKey(dayStart)) || []
  const jobsByWeekDay = weekDays.map((date) => ({
    date,
    jobs: jobSummariesByDay.get(buildDayKey(date)) || [],
  }))
  const jobsByMonthDay = monthDays.map((date) => ({
    date,
    jobs: jobSummariesByDay.get(buildDayKey(date)) || [],
  }))
  const selectedDayJobs = jobSummariesByDay.get(buildDayKey(selectedCalendarDate)) || []

  const moveCalendar = (direction: -1 | 1) => {
    onCalendarDateChange((() => {
      if (calendarView === 'day') return addDays(calendarDate, direction)
      if (calendarView === 'week') return addDays(calendarDate, direction * 7)
      if (calendarView === 'month') return new Date(calendarDate.getFullYear(), calendarDate.getMonth() + direction, 1)
      return addDays(calendarDate, direction * 7)
    })())
  }

  const calendarRangeLabel =
    calendarView === 'day'
      ? calendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
      : calendarView === 'week'
        ? `${formatDateLabel(weekDays[0])} - ${formatDateLabel(weekDays[6])}`
        : calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('calendarView')}</h2>
            <p className="text-sm text-muted-foreground">
              {isLocalMode ? t('calendarViewDescLocal') : t('calendarViewDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => moveCalendar(-1)} variant="outline" size="sm">{t('prev')}</Button>
            <Button onClick={() => onCalendarDateChange(startOfDay(new Date()))} variant="outline" size="sm">{t('today')}</Button>
            <Button onClick={() => moveCalendar(1)} variant="outline" size="sm">{t('next')}</Button>
            <div className="text-sm font-medium text-foreground ml-1">{calendarRangeLabel}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['agenda', 'day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
            <Button
              key={mode}
              onClick={() => onCalendarViewChange(mode)}
              variant={calendarView === mode ? 'default' : 'outline'}
              size="sm"
            >
              {t(`calMode_${mode}` as any)}
            </Button>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
          />
          <select
            value={agentFilter}
            onChange={(e) => onAgentFilterChange(e.target.value)}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
          >
            <option value="all">{t('allAgents')}</option>
            {uniqueAgents.map((agentId) => (
              <option key={agentId} value={agentId}>{agentId}</option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => onStateFilterChange(e.target.value as 'all' | 'enabled' | 'disabled')}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
          >
            <option value="all">{t('allStates')}</option>
            <option value="enabled">{t('enabled')}</option>
            <option value="disabled">{t('disabled')}</option>
          </select>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div className="flex gap-1">
            {(['all', 'cron', 'every', 'at'] as ScheduleKindFilter[]).map((kind) => (
              <Button
                key={kind}
                onClick={() => onScheduleKindFilterChange(kind)}
                variant={scheduleKindFilter === kind ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
              >
                {kind === 'all' ? t('all') : kind}
              </Button>
            ))}
          </div>
          <select
            value={sortField}
            onChange={(e) => onSortFieldChange(e.target.value as SortField)}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
          >
            <option value="name">{t('sortName')}</option>
            <option value="schedule">{t('sortSchedule')}</option>
            <option value="lastRun">{t('sortLastRun')}</option>
            <option value="nextRun">{t('sortNextRun')}</option>
          </select>
          <Button onClick={onSortDirToggle} variant="outline" size="sm" className="text-xs">
            {sortDir === 'asc' ? t('ascending') : t('descending')}
          </Button>
        </div>

        {calendarView === 'agenda' && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {calendarOccurrences.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('noJobsMatchFilters')}</div>
              ) : (
                calendarOccurrences.map((row) => (
                  <Button
                    key={`agenda-${row.job.id || row.job.name}-${row.atMs}`}
                    onClick={() => onJobSelect(row.job)}
                    variant="ghost"
                    className="w-full p-3 h-auto text-left flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                  >
                    <div>
                      <div className="font-medium text-foreground">{row.job.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.job.agentId || 'system'} · {row.job.enabled ? t('enabled') : t('disabled')} · {row.job.schedule}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(row.atMs).toLocaleString()}
                    </div>
                  </Button>
                ))
              )}
            </div>
          </div>
        )}

        {calendarView === 'day' && (
          <div className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{t('uniqueJobs', { count: dayJobSummaries.length })}</span>
            </div>
            {dayJobSummaries.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('noJobsForDay')}</div>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {dayJobSummaries.map((row) => (
                  <Button
                    key={`day-${row.job.id || row.job.name}`}
                    onClick={() => onJobSelect(row.job)}
                    variant="outline"
                    className={`w-full p-2 h-auto text-left flex items-center justify-between gap-2 border ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{row.job.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.job.agentId || 'system'} · {describeCronFrequency(row.job.schedule)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.runCount > 1 ? t('runsCount', { count: row.runCount }) : new Date(row.firstRunMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {calendarView === 'week' && (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {jobsByWeekDay.map(({ date, jobs }) => {
              const totalRuns = jobs.reduce((sum, j) => sum + j.runCount, 0)
              return (
                <div
                  key={`week-${date.toISOString()}`}
                  onClick={() => onSelectedCalendarDateChange(startOfDay(date))}
                  className={`rounded-lg border p-2 min-h-36 cursor-pointer flex flex-col ${isSameDay(date, selectedCalendarDate) ? 'bg-primary/10 border-primary/40' : 'border-border hover:bg-secondary/50'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-medium ${isSameDay(date, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
                      {date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                    </span>
                    {jobs.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{t('jobCount', { count: jobs.length })}</span>
                    )}
                  </div>
                  <div className="space-y-1 flex-1 overflow-hidden">
                    {jobs.slice(0, 5).map((row) => (
                      <div
                        key={`week-job-${row.job.id || row.job.name}`}
                        className={`text-[11px] px-1.5 py-0.5 rounded border truncate ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                        title={`${row.job.name} — ${t('runsCount', { count: row.runCount })}`}
                      >
                        {row.job.name}
                      </div>
                    ))}
                    {jobs.length > 5 && (
                      <div className="text-[10px] text-muted-foreground">{t('moreJobs', { count: jobs.length - 5 })}</div>
                    )}
                  </div>
                  {totalRuns > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border/50">
                      {t('totalRunsCount', { count: totalRuns })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {calendarView === 'month' && (
          <div className="grid grid-cols-7 gap-2">
            {jobsByMonthDay.map(({ date, jobs }) => {
              const inCurrentMonth = date.getMonth() === calendarDate.getMonth()
              const totalRuns = jobs.reduce((sum, j) => sum + j.runCount, 0)
              return (
                <div
                  key={`month-${date.toISOString()}`}
                  onClick={() => onSelectedCalendarDateChange(startOfDay(date))}
                  className={`border border-border rounded-lg p-2 min-h-24 cursor-pointer ${inCurrentMonth ? 'bg-transparent' : 'bg-secondary/30'} ${isSameDay(date, selectedCalendarDate) ? 'border-primary/40 bg-primary/10' : 'hover:bg-secondary/50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${isSameDay(date, new Date()) ? 'text-primary font-semibold' : inCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {date.getDate()}
                    </span>
                    {jobs.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{jobs.length}</span>
                    )}
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {jobs.slice(0, 3).map((row) => (
                      <div
                        key={`month-job-${row.job.id || row.job.name}`}
                        className={`text-[10px] px-1 py-0.5 rounded border truncate ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                        title={`${row.job.name} — ${t('runsCount', { count: row.runCount })}`}
                      >
                        {row.job.name}
                      </div>
                    ))}
                    {jobs.length > 3 && <div className="text-[10px] text-muted-foreground">{t('moreJobs', { count: jobs.length - 3 })}</div>}
                  </div>
                  {totalRuns > 0 && jobs.length > 0 && (
                    <div className="text-[9px] text-muted-foreground mt-0.5">{t('runsCount', { count: totalRuns })}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {calendarView !== 'agenda' && (
          <div className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-foreground">
                {selectedCalendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('jobCount', { count: selectedDayJobs.length })}</span>
                {selectedDayJobs.length > 0 && (
                  <span className="text-xs text-muted-foreground">· {t('totalRunsCount', { count: selectedDayJobs.reduce((s, r) => s + r.runCount, 0) })}</span>
                )}
              </div>
            </div>
            {selectedDayJobs.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('noJobsForDay')}</div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {selectedDayJobs.map((row) => (
                  <Button
                    key={`selected-day-${row.job.id || row.job.name}`}
                    onClick={() => onJobSelect(row.job)}
                    variant="outline"
                    className={`w-full text-left p-2 h-auto flex items-center justify-between gap-2 border ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{row.job.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.job.agentId || 'system'} · {describeCronFrequency(row.job.schedule)}
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="text-xs text-foreground">{t('runsCount', { count: row.runCount })}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {t('firstRun', { time: new Date(row.firstRunMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
