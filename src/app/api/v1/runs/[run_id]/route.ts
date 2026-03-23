import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRun, updateRun } from '@/lib/runs'
import { logger } from '@/lib/logger'

/**
 * GET /api/v1/runs/:run_id — Get a single run.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { run_id } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const run = getRun(run_id, workspaceId)

    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

    return NextResponse.json(run, {
      headers: { 'X-Agent-Run-Protocol': '0.1.0' },
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to get run')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/v1/runs/:run_id — Update a run (status, outcome, cost, steps, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { run_id } = await params
    const body = await request.json()
    const workspaceId = auth.user.workspace_id ?? 1

    const updated = updateRun(run_id, body, workspaceId)
    if (!updated) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

    return NextResponse.json(updated, {
      headers: { 'X-Agent-Run-Protocol': '0.1.0' },
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to update run')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
