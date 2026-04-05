'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl, CronJob } from '@/store'

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
import { filterAndSortJobs, formatRelativeTime, validateForm } from './cron-management/cron-utils'
import { useCronActions } from './cron-management/useCronActions'
import { CronCalendarView } from './cron-management/CronCalendarView'
import { CronJobTable } from './cron-management/CronJobTable'
import { CronJobDetail } from './cron-management/CronJobDetail'
import { CronRunHistory } from './cron-management/CronRunHistory'
import { CronAddJobModal } from './cron-management/CronAddJobModal'
import { ClaudeCodeTeamsSection } from './cron-management/ClaudeCodeTeamsSection'

const EMPTY_JOB: NewJobForm = {
  name: '',
  schedule: '0 * * * *',
  command: '',
  description: '',
  model: '',
  staggerSeconds: '',
}

export function CronManagementPanel(): React.JSX.Element {
  const t = useTranslations('cronManagement')
  const { cronJobs, setCronJobs, dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'

  // ── UI State ────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<Array<{ timestamp: number; message: string; level: string }>>([])
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
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB)

  // ── Derived data ────────────────────────────────────────────────────────────
  const uniqueAgents = Array.from(
    new Set(cronJobs.map((job) => (job.agentId || '').trim()).filter(Boolean))
  )

  const filteredJobs = filterAndSortJobs(cronJobs, {
    searchQuery, agentFilter, stateFilter, scheduleKindFilter, sortField, sortDir,
  })

  // ── Actions hook ────────────────────────────────────────────────────────────
  const actions = useCronActions({
    isLocalMode,
    setCronJobs,
    setIsLoading,
    setError,
    setRunHistory,
    setRunHistoryTotal,
    setRunHistoryHasMore,
    setRunHistoryPage,
    setJobLogs,
    setRunDropdownJobId,
    selectedJobName: selectedJob?.name,
    onJobDeselect: () => setSelectedJob(null),
  })

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    actions.loadCronJobs()
  }, [actions.loadCronJobs])

  useEffect(() => {
    const loadModels = async (): Promise<void> => {
      try {
        const response = await fetch('/api/status?action=models', { signal: AbortSignal.timeout(8000) })
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((m: Record<string, unknown>) => String(m.name || m.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep cron form usable even when model discovery is unavailable.
      }
    }
    loadModels()
  }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleJobSelect = useCallback(
    (job: CronJob): void => {
      setSelectedJob(job)
      actions.loadJobLogs(job)
    },
    [actions],
  )

  const handleOpenRunHistory = useCallback(
    (job: CronJob): void => {
      setShowRunHistory(true)
      actions.openRunHistory(job)
    },
    [actions],
  )

  const handleAddJob = useCallback(async (): Promise<void> => {
    const errors = validateForm(newJob, availableModels)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return
    await actions.addJob({
      ...newJob,
      onSuccess: () => {
        setNewJob(EMPTY_JOB)
        setFormErrors({})
        setShowAddForm(false)
      },
    })
  }, [newJob, availableModels, actions])

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => { setError(null); actions.loadCronJobs() }}
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
              onClick={actions.loadCronJobs}
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
          onToggleJob={actions.toggleJob}
          onTriggerJob={actions.triggerJob}
          onCloneJob={actions.cloneJob}
          onOpenRunHistory={handleOpenRunHistory}
          onRunDropdownJobIdChange={setRunDropdownJobId}
        />

        {selectedJob && (
          <CronJobDetail
            selectedJob={selectedJob}
            jobLogs={jobLogs}
            uniqueAgents={uniqueAgents}
            formatRelativeTime={formatRelativeTime}
            onClose={() => setSelectedJob(null)}
            onTriggerJob={actions.triggerJob}
            onToggleJob={actions.toggleJob}
            onCloneJob={actions.cloneJob}
            onOpenRunHistory={handleOpenRunHistory}
            onRemoveJob={actions.removeJob}
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
            actions.loadRunHistory(selectedJob.id || selectedJob.name, 1, query)
          }}
          onLoadMore={() =>
            actions.loadRunHistory(selectedJob.id || selectedJob.name, runHistoryPage + 1, runHistoryQuery)
          }
        />
      )}

      <ClaudeCodeTeamsSection />

      {showAddForm && (
        <CronAddJobModal
          newJob={newJob}
          formErrors={formErrors}
          availableModels={availableModels}
          onClose={() => setShowAddForm(false)}
          onAddJob={handleAddJob}
          onFormChange={setNewJob}
        />
      )}
    </div>
  )
}
