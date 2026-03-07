import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, updateDecisionSchema } from '@/lib/validation'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const id = parseInt(resolvedParams.id)
    const workspaceId = auth.user.workspace_id

    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid decision ID' }, { status: 400 })
    }

    const decision = db.prepare('SELECT * FROM decision_records WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as any

    if (!decision) {
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
    }

    return NextResponse.json({
      decision: { ...decision, tags: decision.tags ? JSON.parse(decision.tags) : [] }
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/decisions/[id] error')
    return NextResponse.json({ error: 'Failed to fetch decision' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const id = parseInt(resolvedParams.id)
    const workspaceId = auth.user.workspace_id

    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid decision ID' }, { status: 400 })
    }

    const existing = db.prepare('SELECT * FROM decision_records WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
    }

    const validated = await validateBody(request, updateDecisionSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const fieldsToUpdate: string[] = []
    const updateParams: any[] = []

    if (body.decision !== undefined) { fieldsToUpdate.push('decision = ?'); updateParams.push(body.decision) }
    if (body.rationale !== undefined) { fieldsToUpdate.push('rationale = ?'); updateParams.push(body.rationale) }
    if (body.why_not !== undefined) { fieldsToUpdate.push('why_not = ?'); updateParams.push(body.why_not) }
    if (body.owner !== undefined) { fieldsToUpdate.push('owner = ?'); updateParams.push(body.owner) }
    if (body.revisit_by !== undefined) { fieldsToUpdate.push('revisit_by = ?'); updateParams.push(body.revisit_by) }
    if (body.confidence !== undefined) { fieldsToUpdate.push('confidence = ?'); updateParams.push(body.confidence) }
    if (body.status !== undefined) { fieldsToUpdate.push('status = ?'); updateParams.push(body.status) }
    if (body.scope !== undefined) { fieldsToUpdate.push('scope = ?'); updateParams.push(body.scope) }
    if (body.category !== undefined) { fieldsToUpdate.push('category = ?'); updateParams.push(body.category) }
    if (body.tags !== undefined) { fieldsToUpdate.push('tags = ?'); updateParams.push(JSON.stringify(body.tags)) }
    if (body.source !== undefined) { fieldsToUpdate.push('source = ?'); updateParams.push(body.source) }
    if (body.task_id !== undefined) { fieldsToUpdate.push('task_id = ?'); updateParams.push(body.task_id) }

    const now = Math.floor(Date.now() / 1000)
    fieldsToUpdate.push('updated_at = ?')
    updateParams.push(now)

    if (fieldsToUpdate.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    updateParams.push(id, workspaceId)
    db.prepare(`UPDATE decision_records SET ${fieldsToUpdate.join(', ')} WHERE id = ? AND workspace_id = ?`)
      .run(...updateParams)

    db_helpers.logActivity(
      'decision_updated',
      'decision',
      id,
      auth.user.username,
      `Updated decision #${id}`,
      { fields: Object.keys(body) },
      workspaceId
    )

    const updated = db.prepare('SELECT * FROM decision_records WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as any

    const parsed = { ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] }

    eventBus.broadcast('task.updated', parsed)

    return NextResponse.json({ decision: parsed })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/decisions/[id] error')
    return NextResponse.json({ error: 'Failed to update decision' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const id = parseInt(resolvedParams.id)
    const workspaceId = auth.user.workspace_id

    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid decision ID' }, { status: 400 })
    }

    const existing = db.prepare('SELECT * FROM decision_records WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE decision_records SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run('archived', now, id, workspaceId)

    db_helpers.logActivity(
      'decision_archived',
      'decision',
      id,
      auth.user.username,
      `Archived decision #${id}: ${existing.decision?.slice(0, 100)}`,
      {},
      workspaceId
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/decisions/[id] error')
    return NextResponse.json({ error: 'Failed to archive decision' }, { status: 500 })
  }
}
