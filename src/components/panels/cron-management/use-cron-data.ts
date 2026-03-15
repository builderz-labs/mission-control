'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl, CronJob } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { buildDayKey, getCronOccurrences } from '@/lib/cron-occurrences'
import {
  type NewJobForm,
  type CalendarViewMode,
  type CalendarOccurrence,
  type DayJobEntry,
  type DayWithJobs,
  startOfDay,
  addDays,
  getWeekStart,
  getMonthStartGrid,
  formatDateLabel,
} from './types'

const log = createClientLogger('CronManagement')

export function useCronData() {
  const { cronJobs, setCronJobs, dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<any[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week')
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [searchQuery, setSearchQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [newJob, setNewJob] = useState<NewJobForm>({
    name: '',
    schedule: '0 * * * *',
    command: '',
    description: '',
    model: ''
  })

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

  useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models')
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: any) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep cron form usable even when model discovery is unavailable.
      }
    }
    loadAvailableModels()
  }, [])

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
        await loadCronJobs()
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

  // Derived filter data
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

  // Calendar computations
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

  const calendarOccurrences = useMemo<CalendarOccurrence[]>(() => {
    const rows: CalendarOccurrence[] = []
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
    const dayMap = new Map<string, DayJobEntry[]>()
    for (const row of calendarOccurrences) {
      const existing = dayMap.get(row.dayKey) || []
      existing.push({ job: row.job, atMs: row.atMs })
      dayMap.set(row.dayKey, existing)
    }
    return dayMap
  }, [calendarOccurrences])

  const dayJobs: DayJobEntry[] = occurrencesByDay.get(buildDayKey(dayStart)) || []

  const jobsByWeekDay: DayWithJobs[] = weekDays.map((date) => ({
    date,
    jobs: occurrencesByDay.get(buildDayKey(date)) || [],
  }))

  const jobsByMonthDay: DayWithJobs[] = monthDays.map((date) => ({
    date,
    jobs: occurrencesByDay.get(buildDayKey(date)) || [],
  }))

  const selectedDayJobs: DayJobEntry[] = occurrencesByDay.get(buildDayKey(selectedCalendarDate)) || []

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

  return {
    // Core state
    cronJobs,
    isLoading,
    isLocalMode,
    selectedJob,
    jobLogs,
    showAddForm,
    newJob,
    availableModels,

    // Filter state
    searchQuery,
    agentFilter,
    stateFilter,
    uniqueAgents,
    filteredJobs,

    // Calendar state
    calendarView,
    calendarDate,
    selectedCalendarDate,
    calendarOccurrences,
    calendarRangeLabel,
    dayJobs,
    jobsByWeekDay,
    jobsByMonthDay,
    selectedDayJobs,

    // Actions
    loadCronJobs,
    handleJobSelect,
    toggleJob,
    triggerJob,
    addJob,
    removeJob,
    moveCalendar,
    setShowAddForm,
    setNewJob,
    setCalendarView,
    setCalendarDate,
    setSelectedCalendarDate,
    setSearchQuery,
    setAgentFilter,
    setStateFilter,
  }
}

export type CronDataState = ReturnType<typeof useCronData>
