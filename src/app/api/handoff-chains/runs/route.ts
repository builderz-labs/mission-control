import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export interface HandoffChainRunWithName {
  id: number
  chain_id: number
  chain_name: string | null
  status: string
  current_step: number
  input_data: string | null
  output_data: string | null
  error: string | null
  started_at: number
  completed_at: number | null
  workspace_id: number
}

/**
 * GET /api/handoff-chains/runs — list runs for the workspace
 * Query params:
 *   chain_id — optional filter by chain
 *   limit     — max rows, default 20
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const chainIdParam = searchParams.get('chain_id')
    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10)
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100)

    let runs: HandoffChainRunWithName[]

    if (chainIdParam) {
      const chainId = parseInt(chainIdParam, 10)
      runs = db
        .prepare(
          `SELECT r.id, r.chain_id, c.name AS chain_name, r.status, r.current_step,
            r.input_data, r.output_data, r.error, r.started_at, r.completed_at, r.workspace_id
           FROM handoff_chain_runs r
           LEFT JOIN handoff_chains c ON c.id = r.chain_id
           WHERE r.workspace_id = ? AND r.chain_id = ?
           ORDER BY r.started_at DESC LIMIT ?`
        )
        .all(workspaceId, chainId, limit) as HandoffChainRunWithName[]
    } else {
      runs = db
        .prepare(
          `SELECT r.id, r.chain_id, c.name AS chain_name, r.status, r.current_step,
            r.input_data, r.output_data, r.error, r.started_at, r.completed_at, r.workspace_id
           FROM handoff_chain_runs r
           LEFT JOIN handoff_chains c ON c.id = r.chain_id
           WHERE r.workspace_id = ?
           ORDER BY r.started_at DESC LIMIT ?`
        )
        .all(workspaceId, limit) as HandoffChainRunWithName[]
    }

    return NextResponse.json({ success: true, data: runs })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/handoff-chains/runs error')
    return NextResponse.json({ error: 'Failed to fetch chain runs' }, { status: 500 })
  }
}
