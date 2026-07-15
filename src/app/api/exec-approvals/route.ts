import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { execApprovalLimiter } from '@/lib/rate-limit'
import path from 'node:path'
import { z } from 'zod'

const allowlistPatternSchema = z.object({
  pattern: z.string().max(4096),
}).strict()

const allowlistUpdateSchema = z.object({
  agents: z.record(
    z.string().min(1).max(256),
    z.array(allowlistPatternSchema).max(500),
  ).refine((agents) => Object.keys(agents).length <= 500),
  hash: z.string().max(256).optional(),
}).strict()

const approvalResponseSchema = z.object({
  id: z.string().trim().min(1).max(512),
  action: z.enum(['approve', 'deny', 'always_allow']),
  reason: z.string().trim().max(2000).optional(),
}).strict()

function gatewayUrl(p: string): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}${p}`
}

function execApprovalsPath(): string {
  return path.join(config.openclawHome, 'exec-approvals.json')
}

function computeHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * GET /api/exec-approvals - Fetch pending execution approval requests
 * GET /api/exec-approvals?action=allowlist - Fetch per-agent allowlists
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'allowlist') {
    return getAllowlist()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(gatewayUrl('/api/exec-approvals'), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Gateway exec-approvals endpoint returned error')
      return NextResponse.json({ approvals: [] })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      logger.warn('Gateway exec-approvals request timed out')
    } else {
      logger.warn({ err }, 'Gateway exec-approvals unreachable')
    }
    return NextResponse.json({ approvals: [] })
  }
}

async function getAllowlist(): Promise<NextResponse> {
  const filePath = execApprovalsPath()
  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const agents: Record<string, { pattern: string }[]> = {}
    if (parsed?.agents && typeof parsed.agents === 'object') {
      for (const [agentId, agentConfig] of Object.entries(parsed.agents)) {
        const cfg = agentConfig as any
        if (Array.isArray(cfg?.allowlist)) {
          agents[agentId] = cfg.allowlist.map((e: any) => ({ pattern: String(e?.pattern ?? '') }))
        } else {
          agents[agentId] = []
        }
      }
    }
    return NextResponse.json({ agents, hash: computeHash(raw) })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ agents: {}, hash: computeHash('') })
    }
    logger.warn({ err }, 'Failed to read exec-approvals config')
    return NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 })
  }
}

/**
 * PUT /api/exec-approvals - Save allowlist changes
 * Body: { agents: Record<string, { pattern: string }[]>, hash?: string }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = execApprovalLimiter(`${auth.user.workspace_id}:${auth.user.id}`)
  if (rateCheck) return rateCheck

  const parsed = allowlistUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const agentsInvalid = parsed.error.issues.some((issue) => issue.path[0] === 'agents')
    const error = agentsInvalid
      ? 'Invalid execution allowlist request: agents is required or malformed'
      : 'Invalid execution allowlist request'
    return NextResponse.json({ error }, { status: 400 })
  }
  const body = parsed.data

  const filePath = execApprovalsPath()
  try {
    const { readFile, writeFile, mkdir } = require('fs/promises')
    const { existsSync } = require('fs')

    let parsed: any = { version: 1, agents: {} }
    try {
      const raw = await readFile(filePath, 'utf-8')
      parsed = JSON.parse(raw)

      if (body.hash) {
        const serverHash = computeHash(raw)
        if (body.hash !== serverHash) {
          return NextResponse.json(
            { error: 'Config has been modified. Please reload and try again.', code: 'CONFLICT' },
            { status: 409 },
          )
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }

    if (!parsed.agents) parsed.agents = {}

    for (const [agentId, patterns] of Object.entries(body.agents)) {
      if (!parsed.agents[agentId]) parsed.agents[agentId] = {}
      if (patterns.length === 0) {
        delete parsed.agents[agentId].allowlist
      } else {
        parsed.agents[agentId].allowlist = patterns.map((p: { pattern: string }) => ({
          pattern: String(p.pattern ?? ''),
        }))
      }
    }

    const dir = path.dirname(filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const newRaw = JSON.stringify(parsed, null, 2) + '\n'
    await writeFile(filePath, newRaw, { mode: 0o600 })

    return NextResponse.json({ ok: true, hash: computeHash(newRaw) })
  } catch (err: any) {
    logger.error({ err }, 'Failed to save exec-approvals config')
    return NextResponse.json({ error: `Failed to save: ${err.message}` }, { status: 500 })
  }
}

/**
 * POST /api/exec-approvals - Respond to an execution approval request
 * Body: { id: string, action: 'approve' | 'deny' | 'always_allow', reason?: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = execApprovalLimiter(`${auth.user.workspace_id}:${auth.user.id}`)
  if (rateCheck) return rateCheck

  const parsed = approvalResponseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid execution approval response' }, { status: 400 })
  }
  const body = parsed.data

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(gatewayUrl('/api/exec-approvals/respond'), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: body.id,
        action: body.action,
        reason: body.reason,
      }),
    })
    clearTimeout(timeout)

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      logger.error('Gateway exec-approvals respond request timed out')
      return NextResponse.json({ error: 'Gateway request timed out' }, { status: 504 })
    }
    logger.error({ err }, 'Gateway exec-approvals respond failed')
    return NextResponse.json({ error: 'Gateway unreachable' }, { status: 502 })
  }
}
