import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import fs from 'node:fs'
import path from 'node:path'

interface CronJob {
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
interface OpenClawCronJob {
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

interface OpenClawCronFile {
  version: number
  jobs: OpenClawCronJob[]
}

function getCronFilePath(): string {
  const openclawHome = config.openclawHome
  if (!openclawHome) return ''
  return path.join(openclawHome, 'cron', 'jobs.json')
}

function loadCronFile(): OpenClawCronFile | null {
  const filePath = getCronFilePath()
  if (!filePath) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveCronFile(data: OpenClawCronFile): boolean {
  const filePath = getCronFilePath()
  if (!filePath) return false
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    console.error('Failed to write cron file:', err)
    return false
  }
}

function mapLastStatus(status?: string): 'success' | 'error' | 'running' | undefined {
  if (!status) return undefined
  const s = status.toLowerCase()
  if (s === 'success' || s === 'completed' || s === 'updated') return 'success'
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'running' || s === 'pending') return 'running'
  return 'success' // default for unknown non-error statuses
}

function mapOpenClawJob(job: OpenClawCronJob): CronJob {
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (action === 'list') {
      const cronFile = loadCronFile()
      if (!cronFile || !cronFile.jobs) {
        return NextResponse.json({ jobs: [] })
      }

      const jobs = cronFile.jobs.map(mapOpenClawJob)
      return NextResponse.json({ jobs })
    }

    if (action === 'logs') {
      const jobId = searchParams.get('job')
      if (!jobId) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
      }

      // Find the job to get its state info
      const cronFile = loadCronFile()
      const job = cronFile?.jobs.find(j => j.id === jobId || j.name === jobId)

      const logs: Array<{ timestamp: number; message: string; level: string }> = []

      if (job?.state) {
        if (job.state.lastRunAtMs) {
          logs.push({
            timestamp: job.state.lastRunAtMs,
            message: `Job executed — status: ${job.state.lastStatus || 'unknown'}${job.state.lastDurationMs ? ` (${job.state.lastDurationMs}ms)` : ''}`,
            level: job.state.lastStatus === 'error' || job.state.lastStatus === 'failed' ? 'error' : 'info',
          })
        }
        if (job.state.lastError) {
          logs.push({
            timestamp: job.state.lastRunAtMs || Date.now(),
            message: `Error: ${job.state.lastError}`,
            level: 'error',
          })
        }
        if (job.state.nextRunAtMs) {
          logs.push({
            timestamp: Date.now(),
            message: `Next scheduled run: ${new Date(job.state.nextRunAtMs).toLocaleString()}`,
            level: 'info',
          })
        }
      }

      return NextResponse.json({ logs })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Cron API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, jobName, jobId } = body

    if (action === 'toggle') {
      const id = jobId || jobName
      if (!id) {
        return NextResponse.json({ error: 'Job ID or name required' }, { status: 400 })
      }

      const cronFile = loadCronFile()
      if (!cronFile) {
        return NextResponse.json({ error: 'Cron file not found' }, { status: 404 })
      }

      const job = cronFile.jobs.find(j => j.id === id || j.name === id)
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      job.enabled = !job.enabled
      job.updatedAtMs = Date.now()

      if (!saveCronFile(cronFile)) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true, enabled: job.enabled })
    }

    if (action === 'trigger') {
      const id = jobId || jobName
      if (!id) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
      }

      if (process.env.MISSION_CONTROL_ALLOW_COMMAND_TRIGGER !== '1') {
        return NextResponse.json(
          { error: 'Manual triggers disabled. Set MISSION_CONTROL_ALLOW_COMMAND_TRIGGER=1 to enable.' },
          { status: 403 }
        )
      }

      const cronFile = loadCronFile()
      const job = cronFile?.jobs.find(j => j.id === id || j.name === id)
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      // For OpenClaw cron jobs, trigger via the openclaw CLI
      const { runCommand } = await import('@/lib/command')
      try {
        const { stdout, stderr } = await runCommand(config.openclawBin, [
          'cron', 'trigger', job.id
        ], { timeoutMs: 30000 })

        return NextResponse.json({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        })
      } catch (execError: any) {
        return NextResponse.json({
          success: false,
          error: execError.message,
          stdout: execError.stdout?.trim() || '',
          stderr: execError.stderr?.trim() || ''
        }, { status: 500 })
      }
    }

    if (action === 'remove') {
      const id = jobId || jobName
      if (!id) {
        return NextResponse.json({ error: 'Job ID or name required' }, { status: 400 })
      }

      const cronFile = loadCronFile()
      if (!cronFile) {
        return NextResponse.json({ error: 'Cron file not found' }, { status: 404 })
      }

      const idx = cronFile.jobs.findIndex(j => j.id === id || j.name === id)
      if (idx === -1) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      cronFile.jobs.splice(idx, 1)

      if (!saveCronFile(cronFile)) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'add') {
      const { schedule, command, description } = body
      const name = jobName || body.name
      if (!schedule || !command || !name) {
        return NextResponse.json(
          { error: 'Schedule, command, and name required' },
          { status: 400 }
        )
      }

      const cronFile = loadCronFile() || { version: 1, jobs: [] }

      const newJob: OpenClawCronJob = {
        id: `mc-${Date.now().toString(36)}`,
        agentId: String(process.env.MC_CRON_AGENT_ID || process.env.MC_COORDINATOR_AGENT || 'system'),
        name,
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: {
          kind: 'cron',
          expr: schedule,
        },
        payload: {
          kind: 'agentTurn',
          message: command,
        },
        delivery: {
          mode: 'none',
        },
        state: {},
      }

      cronFile.jobs.push(newJob)

      if (!saveCronFile(cronFile)) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Cron management error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
