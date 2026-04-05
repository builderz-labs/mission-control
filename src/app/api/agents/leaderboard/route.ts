import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { computeLeaderboard } from '@/lib/leaderboard-scoring'
import { eventBus } from '@/lib/event-bus'

const VALID_PERIODS = new Set(['day', 'week', 'month'])

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? 'week'

  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: 'Invalid period. Use day, week, or month.' },
      { status: 400 },
    )
  }

  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const db = getDatabase()
    const agents = computeLeaderboard(workspaceId, db, period)

    eventBus.broadcast('leaderboard.updated', { workspaceId, period, count: agents.length })

    return NextResponse.json({ agents, period, generatedAt: Date.now() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute leaderboard'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
