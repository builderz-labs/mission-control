import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { reportActionOutcome } from '@/lib/action-outcomes'

/**
 * POST /api/actions/[id]/outcome — report the realised value of an action's
 * metric directly (OUTCOME fast path). Body: { result: number|null, notes? }.
 * The action is scored immediately regardless of its horizon.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const actionId = parseInt(id, 10)
    if (!Number.isFinite(actionId)) return NextResponse.json({ error: 'invalid action id' }, { status: 400 })

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))
    const result = body?.result == null ? null : Number(body.result)
    if (result != null && Number.isNaN(result)) {
      return NextResponse.json({ error: 'result must be a number or null' }, { status: 400 })
    }

    // Scope check: only report against an action in the caller's workspace.
    const owns = db
      .prepare(`SELECT 1 AS ok FROM agent_actions WHERE id = ? AND workspace_id = ?`)
      .get(actionId, workspaceId) as { ok?: number } | undefined
    if (!owns?.ok) return NextResponse.json({ error: 'action not found' }, { status: 404 })

    const outcome = reportActionOutcome(db, { actionId, workspaceId }, result, body?.notes ?? null)
    if (!outcome) return NextResponse.json({ error: 'action not found' }, { status: 404 })

    return NextResponse.json(outcome)
  } catch (err: any) {
    logger.error({ err }, 'POST /api/actions/[id]/outcome failed')
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
