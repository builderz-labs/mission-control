'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl, CronJob } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
const log = createClientLogger('CronManagement')
import { buildDayKey, getCronOccurrences } from '@/lib/cron-occurrences'

interface NewJobForm {
  name: string
  schedule: string
  command: string
  description: string
  model: string
}

type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month'

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  return addDays(startOfDay(date), -diffToMonday)
}

function getMonthStartGrid(date: Date): Date {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const day = firstOfMonth.getDay()
  return addDays(firstOfMonth, -day)
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CronManagementPanel() {
  const { cronJobs, setCronJobs, dashboardMode, availableModels } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<any[]>([])
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week')
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [searchQuery, setSearchQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [newJob, setNewJob] = useState<NewJobForm>({
    name: '',
    schedule: '0 * * * *', // Every hour
    command: '',
    description: '',
    model: ''
  })

  const formatRelativeTime = (timestamp: string | number, future = false) => {
    const now = new Date().getTime()
    const time = new Date(timestamp).getTime()
    const diff = future ? time - now : now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    return future ? 'soon' : 'just now'
  }

  const loadCronJobs = useCallback(async () => {
    setIsLoading(true)
    try {
      const cronResponse = await fetch('/api/cron?action=list')
      const cronData = await cronResponse.json()
      const cronList = Array.isArray(cronData.jobs) ? cronData.jobs : []

      if (!isLocalMode) {
        setCronJobs(cronList)
        return
      }

      const schedulerResponse = await fetch('/api/scheduler')
      const schedulerData = await schedulerResponse.json()
      const schedulerTasks = Array.isArray(schedulerData.tasks) ? schedulerData.tasks : []
      const mappedSchedulerJobs: CronJob[] = schedulerTasks.map((task: any) => ({
        id: task.id,
        name: task.name || task.id || 'scheduler-task',
        schedule: 'system-managed automation',
        command: `Built-in local automation (${task.id || 'unknown'})`,
        agentId: 'mission-control-local',
        delivery: 'local',
        enabled: task.running ? true : !!task.enabled,
        lastRun: typeof task.lastRun === 'number' ? task.lastRun : undefined,
        nextRun: typeof task.nextRun === 'number' ? task.nextRun : undefined,
        lastStatus: task.running
          ? 'running'
          : (task.lastResult?.ok === false ? 'error' : (task.lastResult?.ok === true ? 'success' : undefined)),
      }))

      setCronJobs([...cronList, ...mappedSchedulerJobs])
    } catch (error) {
      log.error('Failed to load cron jobs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [isLocalMode, setCronJobs])

  useEffect(() => {
    loadCronJobs()
  }, [loadCronJobs])

  const loadJobLogs = async (job: CronJob) => {
    const isLocalAutomation = (job.delivery === 'local' && job.agentId === 'mission-control-local')
    if (isLocalAutomation) {
      const logs: Array<{ timestamp: number; message: string; level: string }> = []
      if (job.lastRun) {
        logs.push({
          timestamp: job.lastRun,
          message: `Last run recorded for ${job.name}`,
          level: job.lastStatus === 'error' ? 'error' : 'info',
        })
      }
      if (job.lastError) {
        logs.push({
          timestamp: job.lastRun || Date.now(),
          message: `Error: ${job.lastError}`,
          level: 'error',
        })
      }
      if (job.nextRun) {
        logs.push({
          timestamp: Date.now(),
          message: `Next scheduled run: ${new Date(job.nextRun).toLocaleString()}`,
          level: 'info',
        })
      }
      if (logs.length === 0) {
        logs.push({
          timestamp: Date.now(),
          message: 'No scheduler telemetry available yet for this local automation task',
          level: 'info',
        })
      }
      setJobLogs(logs)
      return
    }

    try {
      const response = await fetch(`/api/cron?action=logs&job=${encodeURIComponent(job.name)}`)
      const data = await response.json()
      setJobLogs(data.logs || [])
    } catch (error) {
      log.error('Failed to load job logs:', error)
      setJobLogs([])
    }
  }

  const toggleJob = async (job: CronJob) => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          jobName: job.name,
          enabled: !job.enabled
        })
      })

      if (response.ok) {
        await loadCronJobs() // Reload to get updated status
      } else {
        const error = await response.json()
        alert(`Failed to toggle job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to toggle job:', error)
      alert('Network error occurred')
    }
  }

  const triggerJob = async (job: CronJob) => {
    const isLocalAutomation = (job.delivery === 'local' && job.agentId === 'mission-control-local')
    try {
      if (isLocalAutomation) {
        const response = await fetch('/api/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: job.id }),
        })
        const result = await response.json()
        if (response.ok && result.ok) {
          alert(`Local automation executed: ${result.message}`)
        } else {
          alert(`Local automation failed: ${result.error || result.message || 'Unknown error'}`)
        }
        await loadCronJobs()
        return
      }

      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trigger',
          jobId: job.id,
          jobName: job.name,
        })
      })

      const result = await response.json()
      
      if (result.success) {
        alert(`Job executed successfully:\n${result.stdout}`)
      } else {
        alert(`Job failed:\n${result.error}\n${result.stderr}`)
      }
    } catch (error) {
      log.error('Failed to trigger job:', error)
      alert('Network error occurred')
    }
  }

  const addJob = async () => {
    if (!newJob.name || !newJob.schedule || !newJob.command) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          jobName: newJob.name,
          schedule: newJob.schedule,
          command: newJob.command,
          ...(newJob.model.trim() ? { model: newJob.model.trim() } : {})
        })
      })

      if (response.ok) {
        setNewJob({
          name: '',
          schedule: '0 * * * *',
          command: '',
          description: '',
          model: ''
        })
        setShowAddForm(false)
        await loadCronJobs()
      } else {
        const error = await response.json()
        alert(`Failed to add job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to add job:', error)
      alert('Network error occurred')
    }
  }

  const removeJob = async (job: CronJob) => {
    if (!confirm(`Are you sure you want to remove the job "${job.name}"?`)) {
      return
    }

    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          jobName: job.name
        })
      })

      if (response.ok) {
        await loadCronJobs()
        if (selectedJob?.name === job.name) {
          setSelectedJob(null)
        }
      } else {
        const error = await response.json()
        alert(`Failed to remove job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to remove job:', error)
      alert('Network error occurred')
    }
  }

  const handleJobSelect = (job: CronJob) => {
    setSelectedJob(job)
    loadJobLogs(job)
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success': return 'text-green-400'
      case 'error': return 'text-red-400'
      case 'running': return 'text-blue-400'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusBg = (status?: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/20'
      case 'error': return 'bg-red-500/20'
      case 'running': return 'bg-blue-500/20'
      default: return 'bg-gray-500/20'
    }
  }

  const predefinedSchedules = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Daily at 6 AM', value: '0 6 * * *' },
    { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
    { label: 'Monthly (1st)', value: '0 0 1 * *' },
  ]

  const uniqueAgents = Array.from(
    new Set(
      cronJobs
        .map((job) => (job.agentId || '').trim())
        .filter(Boolean)
    )
  )

  const filteredJobs = cronJobs.filter((job) => {
    const query = searchQuery.trim().toLowerCase()
    const matchesQuery =
      !query ||
      job.name.toLowerCase().includes(query) ||
      job.command.toLowerCase().includes(query) ||
      (job.agentId || '').toLowerCase().includes(query) ||
      (job.model || '').toLowerCase().includes(query)

    const matchesAgent = agentFilter === 'all' || (job.agentId || '') === agentFilter
    const matchesState =
      stateFilter === 'all' ||
      (stateFilter === 'enabled' && job.enabled) ||
      (stateFilter === 'disabled' && !job.enabled)

    return matchesQuery && matchesAgent && matchesState
  })

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

  const calendarOccurrences = useMemo(() => {
    const rows: Array<{ job: CronJob; atMs: number; dayKey: string }> = []
    for (const job of filteredJobs) {
      const occurrences = getCronOccurrences(job.schedule, calendarBounds.startMs, calendarBounds.endMs, 1000)
      for (const occurrence of occurrences) {
        rows.push({ job, atMs: occurrence.atMs, dayKey: occurrence.dayKey })
      }

      if (occurrences.length === 0 && typeof job.nextRun === 'number' && job.nextRun >= calendarBounds.startMs && job.nextRun < calendarBounds.endMs) {
        rows.push({ job, atMs: job.nextRun, dayKey: buildDayKey(new Date(job.nextRun)) })
      }
    }

    rows.sort((a, b) => a.atMs - b.atMs)
    return rows
  }, [calendarBounds.endMs, calendarBounds.startMs, filteredJobs])

  const occurrencesByDay = useMemo(() => {
    const dayMap = new Map<string, Array<{ job: CronJob; atMs: number }>>()
    for (const row of calendarOccurrences) {
      const existing = dayMap.get(row.dayKey) || []
      existing.push({ job: row.job, atMs: row.atMs })
      dayMap.set(row.dayKey, existing)
    }
    return dayMap
  }, [calendarOccurrences])

  const dayJobs = occurrencesByDay.get(buildDayKey(dayStart)) || []

  const jobsByWeekDay = weekDays.map((date) => ({
    date,
    jobs: occurrencesByDay.get(buildDayKey(date)) || [],
  }))

  const jobsByMonthDay = monthDays.map((date) => ({
    date,
    jobs: occurrencesByDay.get(buildDayKey(date)) || [],
  }))

  const selectedDayJobs = occurrencesByDay.get(buildDayKey(selectedCalendarDate)) || []

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarDate((prev) => {
      if (calendarView === 'day') return addDays(prev, direction)
      if (calendarView === 'week') return addDays(prev, direction * 7)
      if (calendarView === 'month') return new Date(prev.getFullYear(), prev.getMonth() + direction, 1)
      return addDays(prev, direction * 7)
    })
  }

  const calendarRangeLabel =
    calendarView === 'day'
      ? calendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
      : calendarView === 'week'
        ? `${formatDateLabel(weekDays[0])} - ${formatDateLabel(weekDays[6])}`
        : calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cron Management</h1>
            <p className="text-muted-foreground mt-2">
              Manage automated tasks and scheduled jobs
            </p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={loadCronJobs}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
            >
              Add Job
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Calendar View - Phase A (read-only) */}
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
                  onClick={() => moveCalendar(-1)}
                  className="px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setCalendarDate(startOfDay(new Date()))}
                  className="px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-sm"
                >
                  Today
                </button>
                <button
                  onClick={() => moveCalendar(1)}
                  className="px-2 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Next
                </button>
                <div className="text-sm font-medium text-foreground ml-1">{calendarRangeLabel}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['agenda', 'day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCalendarView(mode)}
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
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jobs, agents, models..."
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              />
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
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
                onChange={(e) => setStateFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All States</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {calendarView === 'agenda' && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-border">
                  {calendarOccurrences.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No jobs match the current filters.</div>
                  ) : (
                    calendarOccurrences.map((row) => (
                      <button
                        key={`agenda-${row.job.id || row.job.name}-${row.atMs}`}
                        onClick={() => handleJobSelect(row.job)}
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
            )}

            {calendarView === 'day' && (
              <div className="border border-border rounded-lg p-3">
                {dayJobs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No scheduled jobs for this day.</div>
                ) : (
                  <div className="space-y-2">
                    {dayJobs.map((row) => (
                      <button
                        key={`day-${row.job.id || row.job.name}-${row.atMs}`}
                        onClick={() => handleJobSelect(row.job)}
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
            )}

            {calendarView === 'week' && (
              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                {jobsByWeekDay.map(({ date, jobs }) => (
                  <button
                    key={`week-${date.toISOString()}`}
                    onClick={() => setSelectedCalendarDate(startOfDay(date))}
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
            )}

            {calendarView === 'month' && (
              <div className="grid grid-cols-7 gap-2">
                {jobsByMonthDay.map(({ date, jobs }) => {
                  const inCurrentMonth = date.getMonth() === calendarDate.getMonth()
                  return (
                    <div
                      key={`month-${date.toISOString()}`}
                      onClick={() => setSelectedCalendarDate(startOfDay(date))}
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
            )}

            {calendarView !== 'agenda' && (
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
                        onClick={() => handleJobSelect(row.job)}
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
            )}
          </div>
        </div>

        {/* Job List */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Scheduled Jobs</h2>
          
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Loading jobs...</span>
            </div>
          ) : cronJobs.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No cron jobs found
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
                      {cronJobs.map((job, index) => {
                        const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
                        return (
                        <div 
                          key={`${job.name}-${index}`} 
                          className={`border border-border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedJob?.name === job.name 
                      ? 'bg-primary/10 border-primary/30' 
                      : 'hover:bg-secondary'
                  }`}
                  onClick={() => handleJobSelect(job)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">{job.name}</span>
                        <div className={`w-2 h-2 rounded-full ${job.enabled ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                        
                        {/* Job Type Tag */}
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                          isLocalAutomation ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                          job.name.includes('backup') ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                          job.name.includes('alert') ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                          job.name.includes('brief') ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                          job.name.includes('scan') ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                          'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
                        }`}>
                          {isLocalAutomation ? 'LOCAL AUTO' :
                           job.name.includes('backup') ? 'BACKUP' :
                           job.name.includes('alert') ? 'ALERT' :
                           job.name.includes('brief') ? 'BRIEF' :
                           job.name.includes('scan') ? 'SCAN' :
                           'TASK'}
                        </span>

                        {job.lastStatus && (
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusBg(job.lastStatus)} ${getStatusColor(job.lastStatus)}`}>
                            {job.lastStatus}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 font-mono">
                        {job.schedule}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 truncate">
                        {job.command}
                      </div>
                      {job.model && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Model: <span className="font-mono">{job.model}</span>
                        </div>
                      )}
                      {job.lastRun && (
                        <div className="text-xs text-muted-foreground mt-2">
                          Last run: {formatRelativeTime(job.lastRun)}
                        </div>
                      )}
                      {job.nextRun && (
                        <div className="text-xs text-primary/70 mt-1">
                          Next: {formatRelativeTime(job.nextRun, true)}
                        </div>
                      )}
                    </div>
                    <div className="flex space-x-1 ml-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleJob(job)
                        }}
                        disabled={isLocalAutomation}
                        className={`px-2 py-1 text-xs rounded ${
                          job.enabled 
                            ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                            : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                        } transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {job.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          triggerJob(job)
                        }}
                        className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                      >
                        Run
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeJob(job)
                        }}
                        disabled={isLocalAutomation}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Job Details & Logs */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">
            {selectedJob ? `Job Details: ${selectedJob.name}` : 'Job Details'}
          </h2>
          
          {selectedJob ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-foreground mb-2">Configuration</h3>
                <div className="bg-secondary rounded p-3 space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Schedule:</span> <code className="font-mono">{selectedJob.schedule}</code></div>
                  <div><span className="text-muted-foreground">Command:</span> <code className="font-mono text-xs">{selectedJob.command}</code></div>
                  {selectedJob.model && (
                    <div><span className="text-muted-foreground">Model:</span> <code className="font-mono text-xs">{selectedJob.model}</code></div>
                  )}
                  <div><span className="text-muted-foreground">Status:</span> {selectedJob.enabled ? '🟢 Enabled' : '🔴 Disabled'}</div>
                  {selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local' && (
                    <div><span className="text-muted-foreground">Source:</span> Local scheduler automation</div>
                  )}
                  {selectedJob.nextRun && (
                    <div><span className="text-muted-foreground">Next run:</span> {new Date(selectedJob.nextRun).toLocaleString()}</div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-medium text-foreground mb-2">Recent Logs</h3>
                <div className="bg-secondary rounded p-3 max-h-64 overflow-y-auto">
                  {jobLogs.length === 0 ? (
                    <div className="text-muted-foreground text-sm">No logs available</div>
                  ) : (
                    <div className="space-y-1 text-xs font-mono">
                      {jobLogs.map((log, index) => (
                        <div key={index} className="text-muted-foreground">
                          <span className="text-xs">[{new Date(log.timestamp).toLocaleString()}]</span> {log.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Select a job to view details and logs
            </div>
          )}
        </div>
      </div>

      {/* Add Job Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl m-4">
            <h2 className="text-xl font-semibold mb-4">Add New Cron Job</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Job Name</label>
                <input
                  type="text"
                  value={newJob.name}
                  onChange={(e) => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., daily-backup, system-check"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Schedule (Cron Format)</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newJob.schedule}
                    onChange={(e) => setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    placeholder="0 * * * *"
                    className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono"
                  />
                  <select
                    value=""
                    onChange={(e) => e.target.value && setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  >
                    <option value="">Quick select...</option>
                    {predefinedSchedules.map((sched) => (
                      <option key={sched.value} value={sched.value}>{sched.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Format: minute hour day month dayOfWeek
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Command</label>
                <textarea
                  value={newJob.command}
                  onChange={(e) => setNewJob(prev => ({ ...prev, command: e.target.value }))}
                  placeholder="cd /path/to/script && ./script.sh"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono h-24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Model (Optional)</label>
                <select
                  value={newJob.model}
                  onChange={(e) => setNewJob(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                >
                  <option value="">Default (agent / gateway)</option>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.alias !== m.name ? `${m.alias} — ` : ''}{m.name}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-muted-foreground">
                  Leave empty to use the agent or gateway default model.
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description (Optional)</label>
                <input
                  type="text"
                  value={newJob.description}
                  onChange={(e) => setNewJob(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What does this job do?"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addJob}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
              >
                Add Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
