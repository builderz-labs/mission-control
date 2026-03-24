import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createRun, listRuns } from '@/lib/runs'
import { logger } from '@/lib/logger'

/**
 * GET /api/v1/runs — List agent runs with filtering.
 * Query params: agent_id, status, since, task_id, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1

    const result = listRuns({
      workspaceId,
      agentId: searchParams.get('agent_id') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      since: searchParams.get('since') ?? undefined,
      taskId: searchParams.get('task_id') ?? undefined,
      limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.has('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    })

    return NextResponse.json(result, {
      headers: { 'X-Agent-Run-Protocol': '0.1.0' },
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to list runs')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/v1/runs — Report a new agent run.
 * Body: AgentRun object per the agent-run spec.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const workspaceId = auth.user.workspace_id ?? 1

    if (!body.agent_id || !body.status || !body.started_at) {
      return NextResponse.json(
        { error: 'Missing required fields: agent_id, status, started_at' },
        { status: 400 },
      )
    }

    if (!body.cost) body.cost = { input_tokens: 0, output_tokens: 0 }
    if (!body.provenance) body.provenance = {}
    if (!body.steps) body.steps = []

    const run = createRun(body, workspaceId)

    return NextResponse.json(
      { id: run.id, run_hash: run.provenance.run_hash },
      {
        status: 201,
        headers: { 'X-Agent-Run-Protocol': '0.1.0' },
      },
    )
  } catch (error) {
    logger.error({ err: error }, 'Failed to create run')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
