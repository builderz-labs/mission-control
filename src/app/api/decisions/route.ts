import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createDecisionSchema } from '@/lib/validation'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)

    const scope = searchParams.get('scope')
    const category = searchParams.get('category')
    const status = searchParams.get('status')
    const taskIdParam = Number.parseInt(searchParams.get('task_id') || '', 10)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = 'SELECT * FROM decision_records WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (scope) {
      query += ' AND scope = ?'
      params.push(scope)
    }
    if (category) {
      query += ' AND category = ?'
      params.push(category)
    }
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    if (Number.isFinite(taskIdParam)) {
      query += ' AND task_id = ?'
      params.push(taskIdParam)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const decisions = db.prepare(query).all(...params) as any[]

    const parsed = decisions.map((d) => ({
      ...d,
      tags: d.tags ? JSON.parse(d.tags) : [],
    }))

    let countQuery = 'SELECT COUNT(*) as total FROM decision_records WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (scope) { countQuery += ' AND scope = ?'; countParams.push(scope) }
    if (category) { countQuery += ' AND category = ?'; countParams.push(category) }
    if (status) { countQuery += ' AND status = ?'; countParams.push(status) }
    if (Number.isFinite(taskIdParam)) { countQuery += ' AND task_id = ?'; countParams.push(taskIdParam) }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ decisions: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/decisions error')
    return NextResponse.json({ error: 'Failed to fetch decisions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const validated = await validateBody(request, createDecisionSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const now = Math.floor(Date.now() / 1000)

    const result = db.prepare(`
      INSERT INTO decision_records (
        workspace_id, task_id, decision, rationale, why_not, owner,
        revisit_by, confidence, status, scope, category, tags, source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId,
      body.task_id ?? null,
      body.decision,
      body.rationale,
      body.why_not,
      body.owner,
      body.revisit_by,
      body.confidence,
      body.status,
      body.scope,
      body.category ?? null,
      JSON.stringify(body.tags),
      body.source ?? null,
      now,
      now
    )

    const decisionId = Number(result.lastInsertRowid)

    db_helpers.logActivity(
      'decision_created',
      'decision',
      decisionId,
      auth.user.username,
      `Created decision: ${body.decision.slice(0, 100)}`,
      { scope: body.scope, confidence: body.confidence },
      workspaceId
    )

    const created = db.prepare('SELECT * FROM decision_records WHERE id = ? AND workspace_id = ?')
      .get(decisionId, workspaceId) as any

    const parsed = { ...created, tags: created.tags ? JSON.parse(created.tags) : [] }

    eventBus.broadcast('decision.created', parsed)

    return NextResponse.json({ decision: parsed }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/decisions error')
    return NextResponse.json({ error: 'Failed to create decision' }, { status: 500 })
  }
}
