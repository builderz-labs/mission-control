import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { ScalingPolicy, ScalingEvent } from '@/lib/scaling-engine'

const updatePolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  min_agents: z.number().int().min(0).max(1000).optional(),
  max_agents: z.number().int().min(1).max(1000).optional(),
  scale_up_threshold: z.number().min(0).max(1).optional(),
  scale_down_threshold: z.number().min(0).max(1).optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  idle_timeout_seconds: z.number().int().min(0).max(86400).optional(),
  auto_approve: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).optional(),
  agent_template: z.string().max(500).nullable().optional(),
  enabled: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).optional(),
})

/**
 * GET /api/scaling/policies/[id] - Get single policy with recent events
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const policyId = parseInt(id, 10)
    if (isNaN(policyId)) {
      return NextResponse.json({ error: 'Invalid policy ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const policy = db.prepare(
      'SELECT * FROM scaling_policies WHERE id = ? AND workspace_id = ?'
    ).get(policyId, workspaceId) as ScalingPolicy | undefined

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }

    const recentEvents = db.prepare(
      'SELECT * FROM scaling_events WHERE policy_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(policyId, workspaceId) as ScalingEvent[]

    return NextResponse.json({ policy, recentEvents })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/scaling/policies/[id] error')
    return NextResponse.json({ error: 'Failed to fetch scaling policy' }, { status: 500 })
  }
}

/**
 * PUT /api/scaling/policies/[id] - Update policy fields
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const policyId = parseInt(id, 10)
    if (isNaN(policyId)) {
      return NextResponse.json({ error: 'Invalid policy ID' }, { status: 400 })
    }

    const result = await validateBody(request, updatePolicySchema)
    if ('error' in result) return result.error

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const existing = db.prepare(
      'SELECT * FROM scaling_policies WHERE id = ? AND workspace_id = ?'
    ).get(policyId, workspaceId) as ScalingPolicy | undefined

    if (!existing) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }

    const data = result.data
    const fields: string[] = []
    const values: (string | number | null)[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.min_agents !== undefined) { fields.push('min_agents = ?'); values.push(data.min_agents) }
    if (data.max_agents !== undefined) { fields.push('max_agents = ?'); values.push(data.max_agents) }
    if (data.scale_up_threshold !== undefined) { fields.push('scale_up_threshold = ?'); values.push(data.scale_up_threshold) }
    if (data.scale_down_threshold !== undefined) { fields.push('scale_down_threshold = ?'); values.push(data.scale_down_threshold) }
    if (data.cooldown_seconds !== undefined) { fields.push('cooldown_seconds = ?'); values.push(data.cooldown_seconds) }
    if (data.idle_timeout_seconds !== undefined) { fields.push('idle_timeout_seconds = ?'); values.push(data.idle_timeout_seconds) }
    if (data.auto_approve !== undefined) { fields.push('auto_approve = ?'); values.push(data.auto_approve) }
    if (data.agent_template !== undefined) { fields.push('agent_template = ?'); values.push(data.agent_template) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled) }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Cross-field validation with merged values
    const mergedMin = data.min_agents ?? existing.min_agents
    const mergedMax = data.max_agents ?? existing.max_agents
    const mergedUp = data.scale_up_threshold ?? existing.scale_up_threshold
    const mergedDown = data.scale_down_threshold ?? existing.scale_down_threshold

    if (mergedDown >= mergedUp) {
      return NextResponse.json(
        { error: 'scale_down_threshold must be less than scale_up_threshold' },
        { status: 400 }
      )
    }

    if (mergedMin > mergedMax) {
      return NextResponse.json(
        { error: 'min_agents cannot exceed max_agents' },
        { status: 400 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    fields.push('updated_at = ?')
    values.push(now)
    values.push(policyId, workspaceId)

    db.prepare(
      `UPDATE scaling_policies SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`
    ).run(...values)

    const updated = db.prepare(
      'SELECT * FROM scaling_policies WHERE id = ?'
    ).get(policyId) as ScalingPolicy

    return NextResponse.json({ policy: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'A policy with that name already exists' }, { status: 409 })
    }
    logger.error({ err }, 'PUT /api/scaling/policies/[id] error')
    return NextResponse.json({ error: 'Failed to update scaling policy' }, { status: 500 })
  }
}

/**
 * DELETE /api/scaling/policies/[id] - Delete policy and cascade events
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const policyId = parseInt(id, 10)
    if (isNaN(policyId)) {
      return NextResponse.json({ error: 'Invalid policy ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const existing = db.prepare(
      'SELECT id FROM scaling_policies WHERE id = ? AND workspace_id = ?'
    ).get(policyId, workspaceId)

    if (!existing) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }

    // Cascade: delete events first, then policy
    db.prepare('DELETE FROM scaling_events WHERE policy_id = ?').run(policyId)
    db.prepare('DELETE FROM scaling_policies WHERE id = ? AND workspace_id = ?').run(policyId, workspaceId)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/scaling/policies/[id] error')
    return NextResponse.json({ error: 'Failed to delete scaling policy' }, { status: 500 })
  }
}
