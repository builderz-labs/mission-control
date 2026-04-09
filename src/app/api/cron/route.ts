import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  loadCronFile,
  saveCronFile,
  mapOpenClawJob,
  type OpenClawCronJob,
} from './cron-helpers'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (action === 'list') {
      const cronFile = await loadCronFile()
      if (!cronFile || !cronFile.jobs) {
        return NextResponse.json({ jobs: [] })
      }
      return NextResponse.json({ jobs: cronFile.jobs.map(mapOpenClawJob) })
    }

    if (action === 'logs') {
      const jobId = searchParams.get('job')
      if (!jobId) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
      }

      const cronFile = await loadCronFile()
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
          logs.push({ timestamp: job.state.lastRunAtMs || Date.now(), message: `Error: ${job.state.lastError}`, level: 'error' })
        }
        if (job.state.nextRunAtMs) {
          logs.push({ timestamp: Date.now(), message: `Next scheduled run: ${new Date(job.state.nextRunAtMs).toLocaleString()}`, level: 'info' })
        }
      }

      return NextResponse.json({ logs })
    }

    if (action === 'history') {
      const jobId = searchParams.get('jobId')
      if (!jobId) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
      }

      const page = parseInt(searchParams.get('page') || '1', 10)
      const query = searchParams.get('query') || ''

      const openclawStateDir = config.openclawStateDir
      if (!openclawStateDir) {
        return NextResponse.json({ entries: [], total: 0, hasMore: false })
      }

      try {
        const runsPath = path.join(openclawStateDir, 'cron', 'runs.json')
        const raw = await readFile(runsPath, 'utf-8')
        const runsData = JSON.parse(raw)
        let entries: Record<string, unknown>[] = Array.isArray(runsData.runs) ? runsData.runs as Record<string, unknown>[] : Array.isArray(runsData) ? runsData as Record<string, unknown>[] : []

        entries = entries.filter((r) => r.jobId === jobId || r.id === jobId)

        if (query) {
          const q = query.toLowerCase()
          entries = entries.filter((r) =>
            (String(r.status || '')).toLowerCase().includes(q) ||
            (String(r.error || '')).toLowerCase().includes(q) ||
            (String(r.deliveryStatus || '')).toLowerCase().includes(q)
          )
        }

        entries.sort((a, b) => (Number(b.timestamp || b.startedAtMs || 0)) - (Number(a.timestamp || a.startedAtMs || 0)))

        const pageSize = 20
        const start = (page - 1) * pageSize
        const paged = entries.slice(start, start + pageSize)

        return NextResponse.json({ entries: paged, total: entries.length, hasMore: start + pageSize < entries.length, page })
      } catch {
        // No runs file — fall back to state-based info
        const cronFile = await loadCronFile()
        const job = cronFile?.jobs.find(j => j.id === jobId || j.name === jobId)
        const entries: Record<string, unknown>[] = []
        if (job?.state?.lastRunAtMs) {
          entries.push({ jobId: job.id, status: job.state.lastStatus || 'unknown', timestamp: job.state.lastRunAtMs, durationMs: job.state.lastDurationMs, error: job.state.lastError })
        }
        return NextResponse.json({ entries, total: entries.length, hasMore: false, page: 1 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Cron API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { action, jobName, jobId } = body

    if (action === 'toggle') {
      const id = jobId || jobName
      if (!id) return NextResponse.json({ error: 'Job ID or name required' }, { status: 400 })

      const cronFile = await loadCronFile()
      if (!cronFile) return NextResponse.json({ error: 'Cron file not found' }, { status: 404 })

      const job = cronFile.jobs.find(j => j.id === id || j.name === id)
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

      // WHY: mutate only the in-memory object right before serialising — not a shared reference
      job.enabled = !job.enabled
      job.updatedAtMs = Date.now()

      if (!(await saveCronFile(cronFile))) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true, enabled: job.enabled })
    }

    if (action === 'trigger') {
      const id = jobId || jobName
      if (!id) return NextResponse.json({ error: 'Job ID required' }, { status: 400 })

      if (process.env.MISSION_CONTROL_ALLOW_COMMAND_TRIGGER !== '1') {
        return NextResponse.json({ error: 'Manual triggers disabled. Set MISSION_CONTROL_ALLOW_COMMAND_TRIGGER=1 to enable.' }, { status: 403 })
      }

      const cronFile = await loadCronFile()
      const job = cronFile?.jobs.find(j => j.id === id || j.name === id)
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

      const triggerMode = body.mode || 'force'
      const { runCommand } = await import('@/lib/command')
      try {
        const args = ['cron', 'trigger', job.id]
        if (triggerMode === 'due') args.push('--if-due')
        const { stdout, stderr } = await runCommand(config.openclawBin, args, { timeoutMs: 30000 })
        return NextResponse.json({ success: true, stdout: stdout.trim(), stderr: stderr.trim() })
      } catch (execError: unknown) {
        // SECURITY: Do not expose raw CLI output to client (HIGH-4 fix)
        const execErr = execError as Record<string, unknown>
        logger.error({ err: execError, stdout: execErr?.stdout, stderr: execErr?.stderr }, 'Cron trigger failed')
        return NextResponse.json({ success: false, error: 'Cron trigger failed. Check server logs for details.' }, { status: 500 })
      }
    }

    if (action === 'remove') {
      const id = jobId || jobName
      if (!id) return NextResponse.json({ error: 'Job ID or name required' }, { status: 400 })

      const cronFile = await loadCronFile()
      if (!cronFile) return NextResponse.json({ error: 'Cron file not found' }, { status: 404 })

      const idx = cronFile.jobs.findIndex(j => j.id === id || j.name === id)
      if (idx === -1) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

      // WHY: splice on the jobs array in-memory then persist — safe since loadCronFile returns a fresh parse
      cronFile.jobs.splice(idx, 1)

      if (!(await saveCronFile(cronFile))) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'add') {
      const { schedule, command, model, staggerSeconds } = body
      const name = jobName || body.name
      if (!schedule || !command || !name) {
        return NextResponse.json({ error: 'Schedule, command, and name required' }, { status: 400 })
      }

      const cronFile = (await loadCronFile()) || { version: 1, jobs: [] }

      // Prevent duplicates: remove existing jobs with the same name
      cronFile.jobs = cronFile.jobs.filter(j => j.name !== name)

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
          ...(typeof staggerSeconds === 'number' && staggerSeconds > 0 ? { staggerMs: staggerSeconds * 1000 } : {}),
        },
        payload: {
          kind: 'agentTurn',
          message: command,
          ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
        },
        delivery: { mode: 'none' },
        state: {},
      }

      cronFile.jobs.push(newJob)

      if (!(await saveCronFile(cronFile))) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'clone') {
      const id = jobId || jobName
      if (!id) return NextResponse.json({ error: 'Job ID required' }, { status: 400 })

      const cronFile = await loadCronFile()
      if (!cronFile) return NextResponse.json({ error: 'Cron file not found' }, { status: 404 })

      const sourceJob = cronFile.jobs.find(j => j.id === id || j.name === id)
      if (!sourceJob) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

      const existingNames = new Set(cronFile.jobs.map(j => j.name.toLowerCase()))
      let cloneName = `${sourceJob.name} (copy)`
      let counter = 2
      while (existingNames.has(cloneName.toLowerCase())) {
        cloneName = `${sourceJob.name} (copy ${counter})`
        counter++
      }

      const clonedJob: OpenClawCronJob = {
        ...JSON.parse(JSON.stringify(sourceJob)),
        id: `mc-${Date.now().toString(36)}`,
        name: cloneName,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        state: {},
      }

      cronFile.jobs.push(clonedJob)

      if (!(await saveCronFile(cronFile))) {
        return NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 })
      }

      return NextResponse.json({ success: true, clonedName: cloneName })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Cron management error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
