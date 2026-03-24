import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getLeaderboard } from '@/lib/runs'
import { logger } from '@/lib/logger'

/**
 * GET /api/v1/evals/leaderboard — Get eval leaderboard.
 * Query params: benchmark_id, limit
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1

    const entries = getLeaderboard({
      workspaceId,
      benchmarkId: searchParams.get('benchmark_id') ?? undefined,
      limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!) : undefined,
    })

    return NextResponse.json({ entries }, {
      headers: { 'X-Agent-Run-Protocol': '0.1.0' },
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to get leaderboard')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
