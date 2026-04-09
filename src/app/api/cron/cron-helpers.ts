import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

export interface CronJob {
  name: string
  schedule: string
  command: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
  // Extended fields from OpenClaw format
  id?: string
  agentId?: string
  timezone?: string
  model?: string
  delivery?: string
}

/**
 * OpenClaw cron jobs live in ~/.openclaw/cron/jobs.json
 * Format: { version: 1, jobs: [ { id, agentId, name, enabled, schedule: { kind, expr, tz }, payload, delivery, state } ] }
 */
export interface OpenClawCronJob {
  id: string
  agentId: string
  name: string
  enabled: boolean
  createdAtMs?: number
  updatedAtMs?: number
  schedule: {
    kind: string
    expr: string
    tz?: string
    staggerMs?: number
  }
  sessionTarget?: string
  wakeMode?: string
  payload: {
    kind: string
    message?: string
    model?: string
    thinking?: string
    timeoutSeconds?: number
  }
  delivery?: {
    mode: string
    channel?: string
    to?: string
  }
  state?: {
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastStatus?: string
    lastDurationMs?: number
    lastError?: string
  }
}

export interface OpenClawCronFile {
  version: number
  jobs: OpenClawCronJob[]
}

export function getCronFilePath(): string {
  const openclawStateDir = config.openclawStateDir
  if (!openclawStateDir) return ''
  return path.join(openclawStateDir, 'cron', 'jobs.json')
}

export async function loadCronFile(): Promise<OpenClawCronFile | null> {
  const filePath = getCronFilePath()
  if (!filePath) return null
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function saveCronFile(data: OpenClawCronFile): Promise<boolean> {
  const filePath = getCronFilePath()
  if (!filePath) return false
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    logger.error({ err }, 'Failed to write cron file')
    return false
  }
}

export function mapLastStatus(status?: string): 'success' | 'error' | 'running' | undefined {
  if (!status) return undefined
  const s = status.toLowerCase()
  if (s === 'success' || s === 'completed' || s === 'updated') return 'success'
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'running' || s === 'pending') return 'running'
  return 'success' // default for unknown non-error statuses
}

export function mapOpenClawJob(job: OpenClawCronJob): CronJob {
  // Build a human-readable command description from the payload
  const payloadSummary = job.payload.message
    ? job.payload.message.slice(0, 200) + (job.payload.message.length > 200 ? '...' : '')
    : `${job.payload.kind} (${job.agentId})`

  const scheduleStr = job.schedule.tz
    ? `${job.schedule.expr} (${job.schedule.tz})`
    : job.schedule.expr

  return {
    id: job.id,
    name: job.name,
    schedule: scheduleStr,
    command: payloadSummary,
    enabled: job.enabled,
    lastRun: job.state?.lastRunAtMs,
    nextRun: job.state?.nextRunAtMs,
    lastStatus: mapLastStatus(job.state?.lastStatus),
    lastError: job.state?.lastError,
    agentId: job.agentId,
    timezone: job.schedule.tz,
    model: job.payload.model,
    delivery: job.delivery?.mode === 'none' ? undefined : job.delivery?.channel,
  }
}
