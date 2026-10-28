import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createHandoffSchema } from '@/lib/validation'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import {
  createHandoffBrief,
  getLatestHandoffForAgent,
  listHandoffBriefs,
} from '@/lib/handoffs'

/**
 * GET /api/handoffs - List handoff briefs, or fetch the latest unconsumed
 * one for an agent when `to_agent` is given without `all=true`.
 * Query params: to_agent, from_agent, task_id, all, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) return wsResult.response
    const { workspaceId } = wsResult
    const { searchParams } = new URL(request.url)

    const toAgent = searchParams.get('to_agent') || undefined
    const fromAgent = searchParams.get('from_agent') || undefined
    const taskIdParam = Number.parseInt(searchParams.get('task_id') || '', 10)
    const taskId = Number.isFinite(taskIdParam) ? taskIdParam : undefined
    const wantsAll = searchParams.get('all') === 'true'

    if (toAgent && !wantsAll) {
      const brief = getLatestHandoffForAgent(toAgent, { taskId, workspaceId })
      return NextResponse.json({ brief })
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    const { briefs, total } = listHandoffBriefs({
      toAgent, fromAgent, taskId, workspaceId, limit, offset,
    })

    return NextResponse.json({ briefs, total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/handoffs error')
    return NextResponse.json({ error: 'Failed to fetch handoffs' }, { status: 500 })
  }
}

/**
 * POST /api/handoffs - Create a handoff brief when one agent/runtime hands
 * a task to another. The receiving side reads it back via GET ?to_agent=
 * (or the mc_get_handoff MCP tool / a SessionStart hook) and marks it
 * consumed via POST /api/handoffs/{id}/consume.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) return wsResult.response
    const { workspaceId } = wsResult

    const validated = await validateBody(request, createHandoffSchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const brief = createHandoffBrief({
      task_id: body.task_id,
      from_agent: body.from_agent,
      to_agent: body.to_agent,
      task_summary: body.task_summary,
      decisions_made: body.decisions_made,
      key_context: body.key_context,
      next_steps: body.next_steps,
      open_questions: body.open_questions,
      refs: body.refs,
      metadata: body.metadata,
    }, workspaceId)

    return NextResponse.json({ brief }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/handoffs error')
    return NextResponse.json({ error: 'Failed to create handoff' }, { status: 500 })
  }
}
