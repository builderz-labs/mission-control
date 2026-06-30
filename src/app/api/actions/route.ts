import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { recordAction, getActionLedger, type RecordActionInput } from '@/lib/action-outcomes'

/**
 * GET /api/actions
 *   ?view=ledger  → the trust ledger (track record per agent/action_type) + summary
 *   (default)     → recent logged actions, newest first
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    if (searchParams.get('view') === 'ledger') {
      return NextResponse.json(getActionLedger(db, workspaceId))
    }

    const status = searchParams.get('status')
    const agent = searchParams.get('agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500)
    const clauses = ['workspace_id = ?']
    const params: unknown[] = [workspaceId]
    if (status) { clauses.push('status = ?'); params.push(status) }
    if (agent) { clauses.push('agent = ?'); params.push(agent) }

    const rows = db
      .prepare(`SELECT * FROM agent_actions WHERE ${clauses.join(' AND ')} ORDER BY taken_at DESC LIMIT ?`)
      .all(...params, limit)
    return NextResponse.json({ actions: rows })
  } catch (err) {
    logger.error({ err }, 'GET /api/actions failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/actions — log an agent action + its hypothesis (CAPTURE).
 * Body: { agent, action_type, metric, target_type?, target_id?, baseline?,
 *         metric_direction?, min_delta?, horizon_days?, reversible?, blast_radius?,
 *         title?, description?, source?, source_task_id?, requested_by?, action_key? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = (await request.json()) as RecordActionInput

    if (!body?.agent || !body?.action_type || !body?.metric) {
      return NextResponse.json({ error: 'agent, action_type and metric are required' }, { status: 400 })
    }

    const result = recordAction(db, body, workspaceId)
    if (result.created) {
      try {
        db_helpers.logActivity(
          'agent_action_recorded', 'agent', 0, body.agent,
          `Action logged: ${body.agent} ${body.action_type} (measuring ${body.metric})`,
          { action_id: result.id, action_key: result.action_key, metric: body.metric, target_id: body.target_id ?? null },
          workspaceId,
        )
      } catch { /* activity logging is best-effort */ }
    }
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/actions failed')
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
