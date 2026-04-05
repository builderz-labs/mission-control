'use client'

// Custom hook that encapsulates all async side-effects for the Cron Management panel.
// Keeps the panel shell free of fetch logic and alert calls.

import { useCallback } from 'react'
import { CronJob } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { RunHistoryEntry } from './cron-management-types'

const log = createClientLogger('CronManagement')

interface UseCronActionsOptions {
  isLocalMode: boolean
  setCronJobs: (jobs: CronJob[]) => void
  setIsLoading: (v: boolean) => void
  setError: (v: string | null) => void
  setRunHistory: React.Dispatch<React.SetStateAction<RunHistoryEntry[]>>
  setRunHistoryTotal: (v: number) => void
  setRunHistoryHasMore: (v: boolean) => void
  setRunHistoryPage: (v: number) => void
  setJobLogs: (v: Array<{ timestamp: number; message: string; level: string }>) => void
  setRunDropdownJobId: (v: string | null) => void
  selectedJobName?: string
  onJobDeselect: () => void
}

export interface CronActions {
  loadCronJobs: () => Promise<void>
  cloneJob: (job: CronJob) => Promise<void>
  loadRunHistory: (jobId: string, page?: number, query?: string) => Promise<void>
  loadJobLogs: (job: CronJob) => Promise<void>
  toggleJob: (job: CronJob) => Promise<void>
  triggerJob: (job: CronJob, mode?: 'force' | 'due') => Promise<void>
  addJob: (params: AddJobParams) => Promise<void>
  removeJob: (job: CronJob) => Promise<void>
  openRunHistory: (job: CronJob) => void
}

export interface AddJobParams {
  name: string
  schedule: string
  command: string
  model: string
  staggerSeconds: string
  onSuccess: () => void
}

export function useCronActions(opts: UseCronActionsOptions): CronActions {
  const {
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
    selectedJobName,
    onJobDeselect,
  } = opts

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

      // Map scheduler tasks to the CronJob shape used by the store
      const mappedSchedulerJobs: CronJob[] = schedulerTasks.map((task: Record<string, unknown>) => ({
        id: task.id as string | undefined,
        name: String(task.name || task.id || 'scheduler-task'),
        schedule: 'system-managed automation',
        command: `Built-in local automation (${String(task.id || 'unknown')})`,
        agentId: 'mission-control-local',
        delivery: 'local',
        enabled: task.running ? true : Boolean(task.enabled),
        lastRun: typeof task.lastRun === 'number' ? task.lastRun : undefined,
        nextRun: typeof task.nextRun === 'number' ? task.nextRun : undefined,
        lastStatus: resolveSchedulerStatus(task),
      }))

      setCronJobs([...cronList, ...mappedSchedulerJobs])
    } catch (err) {
      log.error('Failed to load cron jobs:', err)
      setError('Failed to load. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [isLocalMode, setCronJobs, setIsLoading, setError])

  const cloneJob = useCallback(async (job: CronJob): Promise<void> => {
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
  }, [loadCronJobs])

  const loadRunHistory = useCallback(
    async (jobId: string, page = 1, query = ''): Promise<void> => {
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
    },
    [setRunHistory, setRunHistoryTotal, setRunHistoryHasMore, setRunHistoryPage],
  )

  const openRunHistory = useCallback(
    (job: CronJob): void => {
      setRunHistory([])
      setRunHistoryPage(1)
      loadRunHistory(job.id || job.name, 1, '')
    },
    [loadRunHistory, setRunHistory, setRunHistoryPage],
  )

  const loadJobLogs = useCallback(
    async (job: CronJob): Promise<void> => {
      const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
      if (isLocalAutomation) {
        const logs: Array<{ timestamp: number; message: string; level: string }> = []
        if (job.lastRun)
          logs.push({ timestamp: job.lastRun, message: `Last run recorded for ${job.name}`, level: job.lastStatus === 'error' ? 'error' : 'info' })
        if (job.lastError)
          logs.push({ timestamp: job.lastRun || Date.now(), message: `Error: ${job.lastError}`, level: 'error' })
        if (job.nextRun)
          logs.push({ timestamp: Date.now(), message: `Next scheduled run: ${new Date(job.nextRun).toLocaleString()}`, level: 'info' })
        if (logs.length === 0)
          logs.push({ timestamp: Date.now(), message: 'No scheduler telemetry available yet for this local automation task', level: 'info' })
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
    },
    [setJobLogs],
  )

  const toggleJob = useCallback(
    async (job: CronJob): Promise<void> => {
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
    },
    [loadCronJobs],
  )

  const triggerJob = useCallback(
    async (job: CronJob, mode: 'force' | 'due' = 'force'): Promise<void> => {
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
    },
    [loadCronJobs, setRunDropdownJobId],
  )

  const addJob = useCallback(
    async (params: AddJobParams): Promise<void> => {
      const { name, schedule, command, model, staggerSeconds, onSuccess } = params
      try {
        const staggerVal = staggerSeconds.trim() ? Number(staggerSeconds) : undefined
        const response = await fetch('/api/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            jobName: name,
            schedule,
            command,
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(staggerVal && staggerVal > 0 ? { staggerSeconds: staggerVal } : {}),
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (response.ok) {
          await loadCronJobs()
          onSuccess()
        } else {
          const err = await response.json()
          alert(`Failed to add job: ${err.error}`)
        }
      } catch (err) {
        log.error('Failed to add job:', err)
        alert('Network error occurred')
      }
    },
    [loadCronJobs],
  )

  const removeJob = useCallback(
    async (job: CronJob): Promise<void> => {
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
          if (selectedJobName === job.name) onJobDeselect()
        } else {
          const err = await response.json()
          alert(`Failed to remove job: ${err.error}`)
        }
      } catch (err) {
        log.error('Failed to remove job:', err)
        alert('Network error occurred')
      }
    },
    [loadCronJobs, selectedJobName, onJobDeselect],
  )

  return {
    loadCronJobs,
    cloneJob,
    loadRunHistory,
    loadJobLogs,
    toggleJob,
    triggerJob,
    addJob,
    removeJob,
    openRunHistory,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type SchedulerTask = Record<string, unknown>

function resolveSchedulerStatus(
  task: SchedulerTask,
): 'success' | 'error' | 'running' | undefined {
  if (task.running) return 'running'
  const lastResult = task.lastResult as { ok?: boolean } | undefined
  if (lastResult?.ok === false) return 'error'
  if (lastResult?.ok === true) return 'success'
  return undefined
}
