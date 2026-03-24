import { existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { detectAllRuntimes, detectRuntime, startInstall, getInstallJob, getActiveJobs, generateDockerSidecar } from '@/lib/agent-runtimes'
import type { RuntimeId, DeploymentMode } from '@/lib/agent-runtimes'
import { logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'

const VALID_RUNTIMES = new Set<RuntimeId>(['openclaw', 'hermes', 'claude', 'codex'])
const VALID_MODES = new Set<DeploymentMode>(['local', 'docker'])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const runtimes = detectAllRuntimes()
  const activeJobs = getActiveJobs()
  const isDocker = existsSync('/.dockerenv')

  return NextResponse.json({ runtimes, activeJobs, isDocker })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body

  if (action === 'install') {
    const runtime = body.runtime as RuntimeId
    const mode = (body.mode || 'local') as DeploymentMode
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime. Use: openclaw, hermes' }, { status: 400 })
    }
    if (!VALID_MODES.has(mode)) {
      return NextResponse.json({ error: 'Invalid mode. Use: local, docker' }, { status: 400 })
    }

    logger.info({ runtime, mode, actor: auth.user.username }, 'Starting agent runtime install')
    logAuditEvent({
      action: 'agent_runtime.install',
      actor: auth.user.username,
      detail: JSON.stringify({ runtime, mode }),
    })

    const job = startInstall(runtime, mode)
    return NextResponse.json({ jobId: job.id, job })
  }

  if (action === 'job-status') {
    const { jobId } = body
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    const job = getInstallJob(jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json({ job })
  }

  if (action === 'docker-compose') {
    const runtime = body.runtime as RuntimeId
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime' }, { status: 400 })
    }
    return NextResponse.json({ yaml: generateDockerSidecar(runtime) })
  }

  if (action === 'detect') {
    const runtime = body.runtime as RuntimeId
    if (!runtime || !VALID_RUNTIMES.has(runtime)) {
      return NextResponse.json({ error: 'Invalid runtime' }, { status: 400 })
    }
    const status = detectRuntime(runtime)
    return NextResponse.json({ status })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
