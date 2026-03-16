import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { ScalingPolicy } from '@/lib/scaling-engine'

const createPolicySchema = z.object({
  name: z.string().min(1).max(200),
  min_agents: z.number().int().min(0).max(1000).default(0),
  max_agents: z.number().int().min(1).max(1000).default(10),
  scale_up_threshold: z.number().min(0).max(1).default(0.8),
  scale_down_threshold: z.number().min(0).max(1).default(0.2),
  cooldown_seconds: z.number().int().min(0).max(86400).default(300),
  idle_timeout_seconds: z.number().int().min(0).max(86400).default(600),
  auto_approve: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).default(false),
  agent_template: z.string().max(500).nullable().optional().default(null),
})

/**
 * GET /api/scaling/policies - List all scaling policies
 * Optional query: ?enabled=1 to filter only enabled policies
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const url = new URL(request.url)
    const enabled = url.searchParams.get('enabled')

    let query = 'SELECT * FROM scaling_policies WHERE workspace_id = ?'
    const params: (string | number)[] = [workspaceId]

    if (enabled !== null) {
      query += ' AND enabled = ?'
      params.push(parseInt(enabled, 10))
    }

    query += ' ORDER BY created_at DESC'

    const policies = db.prepare(query).all(...params) as ScalingPolicy[]

    return NextResponse.json({ policies })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/scaling/policies error')
    return NextResponse.json({ error: 'Failed to fetch scaling policies' }, { status: 500 })
  }
}

/**
 * POST /api/scaling/policies - Create a new scaling policy
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createPolicySchema)
    if ('error' in result) return result.error
    const data = result.data

    if (data.scale_down_threshold >= data.scale_up_threshold) {
      return NextResponse.json(
        { error: 'scale_down_threshold must be less than scale_up_threshold' },
        { status: 400 }
      )
    }

    if (data.min_agents > data.max_agents) {
      return NextResponse.json(
        { error: 'min_agents cannot exceed max_agents' },
        { status: 400 }
      )
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)

    const info = db.prepare(`
      INSERT INTO scaling_policies (name, min_agents, max_agents, scale_up_threshold, scale_down_threshold,
        cooldown_seconds, idle_timeout_seconds, auto_approve, agent_template, enabled, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      data.name, data.min_agents, data.max_agents,
      data.scale_up_threshold, data.scale_down_threshold,
      data.cooldown_seconds, data.idle_timeout_seconds,
      data.auto_approve, data.agent_template,
      workspaceId, now, now
    )

    const policy = db.prepare('SELECT * FROM scaling_policies WHERE id = ?').get(
      Number(info.lastInsertRowid)
    ) as ScalingPolicy

    return NextResponse.json({ policy }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create scaling policy'
    if (message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'A policy with that name already exists' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/scaling/policies error')
    return NextResponse.json({ error: 'Failed to create scaling policy' }, { status: 500 })
  }
}
