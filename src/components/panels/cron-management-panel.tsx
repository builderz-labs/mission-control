'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl, CronJob } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
const log = createClientLogger('CronManagement')

import {
  NewJobForm,
  FormErrors,
  RunHistoryEntry,
  ScheduleKindFilter,
  SortField,
  SortDir,
  CalendarViewMode,
  startOfDay,
} from './cron-management/cron-management-types'
import { CronCalendarView } from './cron-management/CronCalendarView'
import { CronJobTable } from './cron-management/CronJobTable'
import { CronJobDetail } from './cron-management/CronJobDetail'
import { CronRunHistory } from './cron-management/CronRunHistory'
import { CronAddJobModal } from './cron-management/CronAddJobModal'
import { ClaudeCodeTeamsSection } from './cron-management/ClaudeCodeTeamsSection'

export function CronManagementPanel(): React.JSX.Element {
  const t = useTranslations('cronManagement')
  const { cronJobs, setCronJobs, dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const [scheduleKindFilter, setScheduleKindFilter] = useState<ScheduleKindFilter>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([])
  const [runHistoryTotal, setRunHistoryTotal] = useState(0)
  const [runHistoryHasMore, setRunHistoryHasMore] = useState(false)
  const [runHistoryPage, setRunHistoryPage] = useState(1)
  const [runHistoryQuery, setRunHistoryQuery] = useState('')
  const [showRunHistory, setShowRunHistory] = useState(false)
  const [runDropdownJobId, setRunDropdownJobId] = useState<string | null>(null)
  const [newJob, setNewJob] = useState<NewJobForm>({
    name: '',
    schedule: '0 * * * *',
    command: '',
    description: '',
    model: '',
    staggerSeconds: '',
  })

  const formatRelativeTime = (timestamp: string | number, future = false): string => {
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

  const loadCronJobs = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const cronResponse = await fetch('/api/cron?action=list', { signal: AbortSignal.timeout(8000) })
      const cronData = await cronResponse.json()
      const cronList = Array.isArray(cronData.jobs) ? cronData.jobs : []

      if (!isLocalMode) {
        setCronJobs(cronList)
        return
      }

      const schedulerResponse = await fetch('/api/scheduler', { signal: AbortSignal.timeout(8000) })
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
          : task.lastResult?.ok === false
            ? 'error'
            : task.lastResult?.ok === true
              ? 'success'
              : undefined,
      }))

      setCronJobs([...cronList, ...mappedSchedulerJobs])
    } catch (err) {
      log.error('Failed to load cron jobs:', err)
      setError('Failed to load. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [isLocalMode, setCronJobs])

  useEffect(() => {
    loadCronJobs()
  }, [loadCronJobs])

  useEffect(() => {
    const loadAvailableModels = async (): Promise<void> => {
      try {
        const response = await fetch('/api/status?action=models', { signal: AbortSignal.timeout(8000) })
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

  const validateForm = useCallback((form: NewJobForm): FormErrors => {
    const errors: FormErrors = {}
    if (!form.name.trim()) errors.name = 'Job name is required'
    if (!form.command.trim()) errors.command = 'Command is required'
    const cronParts = form.schedule.trim().split(/\s+/)
    if (cronParts.length !== 5) {
      errors.schedule = 'Must be 5 fields: minute hour day month weekday'
    } else {
      const cronFieldPattern = /^(\*|(\*\/\d+)|(\d+(-\d+)?(,\d+(-\d+)?)*))(\/\d+)?$/
      for (const part of cronParts) {
        if (!cronFieldPattern.test(part)) {
          errors.schedule = `Invalid cron field: "${part}"`
          break
        }
      }
    }
    if (form.model.trim() && availableModels.length > 0) {
      if (!availableModels.includes(form.model.trim())) {
        errors.model = `Unknown model. Available: ${availableModels.slice(0, 3).join(', ')}${availableModels.length > 3 ? '...' : ''}`
      }
    }
    if (form.staggerSeconds.trim()) {
      const val = Number(form.staggerSeconds)
      if (!Number.isFinite(val) || val <= 0) {
        errors.staggerSeconds = 'Must be a positive number'
      }
    }
    return errors
  }, [availableModels])

  const cloneJob = async (job: CronJob): Promise<void> => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clone', jobId: job.id, jobName: job.name }),
        signal: AbortSignal.timeout(8000),
      })
      const result = await response.json()
      if (result.success) {
        await loadCronJobs()
      } else {
        alert(`Failed to clone job: ${result.error}`)
      }
    } catch (err) {
      log.error('Failed to clone job:', err)
      alert('Network error occurred')
    }
  }

  const loadRunHistory = useCallback(async (jobId: string, page = 1, query = ''): Promise<void> => {
    try {
      const params = new URLSearchParams({
        action: 'history',
        jobId,
        page: String(page),
        ...(query ? { query } : {}),
      })
      const response = await fetch(`/api/cron?${params}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      if (page === 1) {
        setRunHistory(data.entries || [])
      } else {
        setRunHistory((prev) => [...prev, ...(data.entries || [])])
      }
      setRunHistoryTotal(data.total || 0)
      setRunHistoryHasMore(data.hasMore || false)
      setRunHistoryPage(page)
    } catch (err) {
      log.error('Failed to load run history:', err)
    }
  }, [])

  const openRunHistory = (job: CronJob): void => {
    setShowRunHistory(true)
    setRunHistory([])
    setRunHistoryPage(1)
    setRunHistoryQuery('')
    loadRunHistory(job.id || job.name, 1, '')
  }

  const loadJobLogs = async (job: CronJob): Promise<void> => {
    const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
    if (isLocalAutomation) {
      const logs: Array<{ timestamp: number; message: string; level: string }> = []
      if (job.lastRun) logs.push({ timestamp: job.lastRun, message: `Last run recorded for ${job.name}`, level: job.lastStatus === 'error' ? 'error' : 'info' })
      if (job.lastError) logs.push({ timestamp: job.lastRun || Date.now(), message: `Error: ${job.lastError}`, level: 'error' })
      if (job.nextRun) logs.push({ timestamp: Date.now(), message: `Next scheduled run: ${new Date(job.nextRun).toLocaleString()}`, level: 'info' })
      if (logs.length === 0) logs.push({ timestamp: Date.now(), message: 'No scheduler telemetry available yet for this local automation task', level: 'info' })
      setJobLogs(logs)
      return
    }
    try {
      const response = await fetch(`/api/cron?action=logs&job=${encodeURIComponent(job.name)}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setJobLogs(data.logs || [])
    } catch (err) {
      log.error('Failed to load job logs:', err)
      setJobLogs([])
    }
  }

  const toggleJob = async (job: CronJob): Promise<void> => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', jobName: job.name, enabled: !job.enabled }),
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        await loadCronJobs()
      } else {
        const err = await response.json()
        alert(`Failed to toggle job: ${err.error}`)
      }
    } catch (err) {
      log.error('Failed to toggle job:', err)
      alert('Network error occurred')
    }
  }

  const triggerJob = async (job: CronJob, mode: 'force' | 'due' = 'force'): Promise<void> => {
    const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
    setRunDropdownJobId(null)
    try {
      if (isLocalAutomation) {
        const response = await fetch('/api/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: job.id }),
          signal: AbortSignal.timeout(8000),
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
        body: JSON.stringify({ action: 'trigger', jobId: job.id, jobName: job.name, mode }),
        signal: AbortSignal.timeout(8000),
      })
      const result = await response.json()
      if (result.success) {
        alert(`Job executed successfully:\n${result.stdout}`)
      } else {
        alert(`Job failed:\n${result.error}\n${result.stderr}`)
      }
    } catch (err) {
      log.error('Failed to trigger job:', err)
      alert('Network error occurred')
    }
  }

  const addJob = async (): Promise<void> => {
    const errors = validateForm(newJob)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return
    try {
      const staggerVal = newJob.staggerSeconds.trim() ? Number(newJob.staggerSeconds) : undefined
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          jobName: newJob.name,
          schedule: newJob.schedule,
          command: newJob.command,
          ...(newJob.model.trim() ? { model: newJob.model.trim() } : {}),
          ...(staggerVal && staggerVal > 0 ? { staggerSeconds: staggerVal } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        setNewJob({ name: '', schedule: '0 * * * *', command: '', description: '', model: '', staggerSeconds: '' })
        setFormErrors({})
        setShowAddForm(false)
        await loadCronJobs()
      } else {
        const err = await response.json()
        alert(`Failed to add job: ${err.error}`)
      }
    } catch (err) {
      log.error('Failed to add job:', err)
      alert('Network error occurred')
    }
  }

  const removeJob = async (job: CronJob): Promise<void> => {
    if (!confirm(`Are you sure you want to remove the job "${job.name}"?`)) return
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', jobName: job.name }),
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        await loadCronJobs()
        if (selectedJob?.name === job.name) setSelectedJob(null)
      } else {
        const err = await response.json()
        alert(`Failed to remove job: ${err.error}`)
      }
    } catch (err) {
      log.error('Failed to remove job:', err)
      alert('Network error occurred')
    }
  }

  const handleJobSelect = (job: CronJob): void => {
    setSelectedJob(job)
    loadJobLogs(job)
  }

  const uniqueAgents = Array.from(
    new Set(cronJobs.map((job) => (job.agentId || '').trim()).filter(Boolean))
  )

  const filteredJobs = cronJobs
    .filter((job) => typeof job.schedule === 'string' && job.schedule.length > 0)
    .filter((job) => {
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
      let matchesKind = true
      if (scheduleKindFilter !== 'all') {
        const sched = job.schedule.toLowerCase()
        if (scheduleKindFilter === 'cron') {
          matchesKind = sched.replace(/\s*\([^)]+\)$/, '').trim().split(/\s+/).length === 5
        } else if (scheduleKindFilter === 'every') {
          matchesKind = sched.startsWith('every') || sched.includes('*/')
        } else if (scheduleKindFilter === 'at') {
          matchesKind = sched.startsWith('at ') || /^\d{4}-/.test(sched)
        }
      }
      return matchesQuery && matchesAgent && matchesState && matchesKind
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'name': return dir * a.name.localeCompare(b.name)
        case 'schedule': return dir * (a.schedule || '').localeCompare(b.schedule || '')
        case 'lastRun': return dir * ((a.lastRun || 0) - (b.lastRun || 0))
        case 'nextRun': return dir * ((a.nextRun || 0) - (b.nextRun || 0))
        default: return 0
      }
    })

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => { setError(null); loadCronJobs() }}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >
            Retry
          </button>
        </div>
      )}

      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
          </div>
          <div className="flex space-x-2">
            <Button
              onClick={loadCronJobs}
              disabled={isLoading}
              className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
            >
              {isLoading ? t('loading') : t('refresh')}
            </Button>
            <Button onClick={() => setShowAddForm(true)}>{t('addJob')}</Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <CronCalendarView
          filteredJobs={filteredJobs}
          uniqueAgents={uniqueAgents}
          calendarView={calendarView}
          calendarDate={calendarDate}
          selectedCalendarDate={selectedCalendarDate}
          searchQuery={searchQuery}
          agentFilter={agentFilter}
          stateFilter={stateFilter}
          scheduleKindFilter={scheduleKindFilter}
          sortField={sortField}
          sortDir={sortDir}
          isLocalMode={isLocalMode}
          onJobSelect={handleJobSelect}
          onCalendarViewChange={setCalendarView}
          onCalendarDateChange={setCalendarDate}
          onSelectedCalendarDateChange={setSelectedCalendarDate}
          onSearchQueryChange={setSearchQuery}
          onAgentFilterChange={setAgentFilter}
          onStateFilterChange={setStateFilter}
          onScheduleKindFilterChange={setScheduleKindFilter}
          onSortFieldChange={setSortField}
          onSortDirToggle={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
        />

        <CronJobTable
          filteredJobs={filteredJobs}
          cronJobs={cronJobs}
          uniqueAgents={uniqueAgents}
          isLoading={isLoading}
          selectedJob={selectedJob}
          runDropdownJobId={runDropdownJobId}
          formatRelativeTime={formatRelativeTime}
          onJobSelect={handleJobSelect}
          onToggleJob={toggleJob}
          onTriggerJob={triggerJob}
          onCloneJob={cloneJob}
          onOpenRunHistory={openRunHistory}
          onRunDropdownJobIdChange={setRunDropdownJobId}
        />

        {selectedJob && (
          <CronJobDetail
            selectedJob={selectedJob}
            jobLogs={jobLogs}
            uniqueAgents={uniqueAgents}
            formatRelativeTime={formatRelativeTime}
            onClose={() => setSelectedJob(null)}
            onTriggerJob={triggerJob}
            onToggleJob={toggleJob}
            onCloneJob={cloneJob}
            onOpenRunHistory={openRunHistory}
            onRemoveJob={removeJob}
          />
        )}
      </div>

      {showRunHistory && selectedJob && (
        <CronRunHistory
          selectedJob={selectedJob}
          runHistory={runHistory}
          runHistoryTotal={runHistoryTotal}
          runHistoryHasMore={runHistoryHasMore}
          runHistoryPage={runHistoryPage}
          runHistoryQuery={runHistoryQuery}
          onClose={() => setShowRunHistory(false)}
          onQueryChange={(query) => {
            setRunHistoryQuery(query)
            loadRunHistory(selectedJob.id || selectedJob.name, 1, query)
          }}
          onLoadMore={() => loadRunHistory(selectedJob.id || selectedJob.name, runHistoryPage + 1, runHistoryQuery)}
        />
      )}

      <ClaudeCodeTeamsSection />

      {showAddForm && (
        <CronAddJobModal
          newJob={newJob}
          formErrors={formErrors}
          availableModels={availableModels}
          onClose={() => setShowAddForm(false)}
          onAddJob={addJob}
          onFormChange={setNewJob}
        />
      )}
    </div>
  )
}
