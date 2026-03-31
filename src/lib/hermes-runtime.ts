import { getHermesMemory } from './hermes-memory'
import { isHermesGatewayRunning, isHermesInstalled, scanHermesSessions } from './hermes-sessions'
import { getHermesTasks, type HermesCronJob } from './hermes-tasks'

export type HermesRecoveryState = 'missing' | 'success' | 'warning' | 'error'

export interface HermesAutomationStatus {
  active: boolean
  label: string
  enabledJobs: number
  totalJobs: number
  latestJobId: string | null
  latestJobName: string | null
  latestRunAt: string | null
}

export interface HermesRecoveryStatus {
  state: HermesRecoveryState
  label: string
  detail: string | null
  jobId: string | null
  jobName: string | null
  lastRunAt: string | null
}

export interface HermesRuntimeStatus {
  installed: boolean
  gatewayRunning: boolean
  activeSessions: number
  cronJobCount: number
  memoryEntries: number
  automation: HermesAutomationStatus
  hhRecovery: HermesRecoveryStatus
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getJobLabel(job: HermesCronJob): string {
  return job.prompt?.trim() || job.id || 'Hermes job'
}

function pickLatestJob(jobs: HermesCronJob[]): HermesCronJob | null {
  if (jobs.length === 0) return null

  return [...jobs].sort((a, b) => {
    const aTs = Math.max(parseTimestamp(a.lastRunAt), parseTimestamp(a.createdAt))
    const bTs = Math.max(parseTimestamp(b.lastRunAt), parseTimestamp(b.createdAt))
    return bTs - aTs
  })[0] ?? null
}

function shortenDetail(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= 160) return collapsed
  return `${collapsed.slice(0, 159).trimEnd()}…`
}

function classifyRecoveryOutput(output: string): HermesRecoveryState {
  const normalized = output.toLowerCase()
  if (/(failed|error|blocked|abort|exception)/.test(normalized)) return 'error'
  if (/(retry|warning|warn|partial|attention|degraded)/.test(normalized)) return 'warning'
  if (/(success|succeeded|completed|done|passed|healthy|ok)/.test(normalized)) return 'success'
  return 'warning'
}

function buildRecoveryStatus(jobs: HermesCronJob[]): HermesRecoveryStatus {
  const recoveryJobs = jobs.filter((job) =>
    /hh|holy hedgehog|recovery/i.test([job.id, job.prompt, job.lastOutput].filter(Boolean).join(' '))
  )
  const latestJob = pickLatestJob(recoveryJobs)

  if (!latestJob) {
    return {
      state: 'missing',
      label: 'No HH recovery job found',
      detail: 'Hermes has no recovery cron job to inspect yet.',
      jobId: null,
      jobName: null,
      lastRunAt: null,
    }
  }

  const lastRunAt = latestJob.lastRunAt || latestJob.createdAt || null
  const output = latestJob.lastOutput?.trim() || ''
  if (!output) {
    return {
      state: 'missing',
      label: 'HH recovery has no recorded output',
      detail: `Job ${getJobLabel(latestJob)} has not produced output yet.`,
      jobId: latestJob.id || null,
      jobName: getJobLabel(latestJob),
      lastRunAt,
    }
  }

  const state = classifyRecoveryOutput(output)
  const labelMap: Record<HermesRecoveryState, string> = {
    missing: 'No HH recovery job found',
    success: 'HH recovery completed',
    warning: 'HH recovery needs attention',
    error: 'HH recovery failed',
  }

  return {
    state,
    label: labelMap[state],
    detail: shortenDetail(output),
    jobId: latestJob.id || null,
    jobName: getJobLabel(latestJob),
    lastRunAt,
  }
}

function buildAutomationStatus(jobs: HermesCronJob[], gatewayRunning: boolean): HermesAutomationStatus {
  const enabledJobs = jobs.filter((job) => job.enabled !== false)
  const latestJob = pickLatestJob(enabledJobs)
  const active = gatewayRunning && enabledJobs.length > 0

  return {
    active,
    label: active
      ? 'Automation active'
      : enabledJobs.length > 0
        ? 'Automation staged'
        : 'Automation idle',
    enabledJobs: enabledJobs.length,
    totalJobs: jobs.length,
    latestJobId: latestJob?.id || null,
    latestJobName: latestJob ? getJobLabel(latestJob) : null,
    latestRunAt: latestJob?.lastRunAt || latestJob?.createdAt || null,
  }
}

export function getHermesRuntimeStatus(): HermesRuntimeStatus {
  const installed = isHermesInstalled()
  const gatewayRunning = installed ? isHermesGatewayRunning() : false
  const sessions = installed ? scanHermesSessions(50) : []
  const tasks = installed ? getHermesTasks().cronJobs : []
  const memoryEntries = installed ? getHermesMemory().agentMemoryEntries : 0

  return {
    installed,
    gatewayRunning,
    activeSessions: sessions.filter((session) => session.isActive).length,
    cronJobCount: tasks.length,
    memoryEntries,
    automation: buildAutomationStatus(tasks, gatewayRunning),
    hhRecovery: buildRecoveryStatus(tasks),
  }
}
