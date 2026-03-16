import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  evaluateScaling,
  executeScaleUp,
  executeScaleDown,
  getScalingMetrics,
} from '@/lib/scaling-engine'
import type { ScalingPolicy, ScalingEvent } from '@/lib/scaling-engine'

const evaluateSchema = z.object({
  policyId: z.number().int().positive(),
})

/**
 * POST /api/scaling/evaluate - Trigger scaling evaluation for a policy
 *
 * If the policy has auto_approve enabled and an event is created,
 * it will be executed immediately.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, evaluateSchema)
    if ('error' in result) return result.error
    const { policyId } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify policy exists and belongs to workspace
    const policy = db.prepare(
      'SELECT * FROM scaling_policies WHERE id = ? AND workspace_id = ?'
    ).get(policyId, workspaceId) as ScalingPolicy | undefined

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }

    if (!policy.enabled) {
      return NextResponse.json({ error: 'Policy is disabled' }, { status: 400 })
    }

    const metrics = getScalingMetrics(db, workspaceId)
    const event = evaluateScaling(db, policyId, workspaceId)

    if (!event) {
      return NextResponse.json({ event: null, metrics, reason: 'No scaling action needed' })
    }

    // Auto-approve: execute immediately
    if (policy.auto_approve) {
      if (event.event_type === 'scale_up') {
        const agentId = executeScaleUp(db, event.id, workspaceId)
        const executed = db.prepare(
          'SELECT * FROM scaling_events WHERE id = ?'
        ).get(event.id) as ScalingEvent
        return NextResponse.json({ event: executed, metrics, agentId, autoApproved: true }, { status: 201 })
      } else if (event.event_type === 'scale_down') {
        // Find an idle agent to scale down
        const idleAgent = db.prepare(
          "SELECT id FROM agents WHERE workspace_id = ? AND status = 'idle' ORDER BY updated_at ASC LIMIT 1"
        ).get(workspaceId) as { id: number } | undefined

        if (idleAgent) {
          executeScaleDown(db, event.id, idleAgent.id, workspaceId)
          const executed = db.prepare(
            'SELECT * FROM scaling_events WHERE id = ?'
          ).get(event.id) as ScalingEvent
          return NextResponse.json({ event: executed, metrics, agentId: idleAgent.id, autoApproved: true }, { status: 201 })
        }
      }
    }

    return NextResponse.json({ event, metrics, autoApproved: false }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/scaling/evaluate error')
    return NextResponse.json({ error: 'Failed to evaluate scaling' }, { status: 500 })
  }
}
