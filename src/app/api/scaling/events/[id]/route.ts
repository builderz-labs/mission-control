import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { executeScaleUp, executeScaleDown } from '@/lib/scaling-engine'
import type { ScalingEvent } from '@/lib/scaling-engine'

const eventActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  agentId: z.number().int().positive().optional(),
})

/**
 * GET /api/scaling/events/[id] - Get single scaling event
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const eventId = parseInt(id, 10)
    if (isNaN(eventId)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const event = db.prepare(
      'SELECT * FROM scaling_events WHERE id = ? AND workspace_id = ?'
    ).get(eventId, workspaceId) as ScalingEvent | undefined

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    return NextResponse.json({ event })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/scaling/events/[id] error')
    return NextResponse.json({ error: 'Failed to fetch scaling event' }, { status: 500 })
  }
}

/**
 * PUT /api/scaling/events/[id] - Approve or reject a pending scaling event
 *
 * Body: { action: 'approve' | 'reject', agentId?: number }
 * - approve + scale_up: calls executeScaleUp
 * - approve + scale_down: calls executeScaleDown (agentId required)
 * - reject: sets status to 'rejected'
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
    const eventId = parseInt(id, 10)
    if (isNaN(eventId)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 })
    }

    const result = await validateBody(request, eventActionSchema)
    if ('error' in result) return result.error
    const { action, agentId } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const event = db.prepare(
      'SELECT * FROM scaling_events WHERE id = ? AND workspace_id = ?'
    ).get(eventId, workspaceId) as ScalingEvent | undefined

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    if (event.status !== 'pending') {
      return NextResponse.json(
        { error: `Event is already ${event.status}, cannot ${action}` },
        { status: 400 }
      )
    }

    if (action === 'reject') {
      const now = Math.floor(Date.now() / 1000)
      db.prepare(
        'UPDATE scaling_events SET status = ?, resolved_at = ? WHERE id = ?'
      ).run('rejected', now, eventId)

      const updated = db.prepare('SELECT * FROM scaling_events WHERE id = ?').get(eventId) as ScalingEvent
      return NextResponse.json({ event: updated })
    }

    // action === 'approve'
    if (event.event_type === 'scale_up') {
      const newAgentId = executeScaleUp(db, eventId, workspaceId)
      const updated = db.prepare('SELECT * FROM scaling_events WHERE id = ?').get(eventId) as ScalingEvent
      return NextResponse.json({ event: updated, agentId: newAgentId })
    }

    if (event.event_type === 'scale_down') {
      if (!agentId) {
        return NextResponse.json(
          { error: 'agentId is required for scale_down approval' },
          { status: 400 }
        )
      }
      executeScaleDown(db, eventId, agentId, workspaceId)
      const updated = db.prepare('SELECT * FROM scaling_events WHERE id = ?').get(eventId) as ScalingEvent
      return NextResponse.json({ event: updated, agentId })
    }

    return NextResponse.json({ error: `Unknown event type: ${event.event_type}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process scaling event'
    if (message.includes('not found') || message.includes('Cannot') || message.includes('cap')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'PUT /api/scaling/events/[id] error')
    return NextResponse.json({ error: 'Failed to process scaling event' }, { status: 500 })
  }
}
