import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getDebateStatus } from '@/lib/debate-engine'

/**
 * GET /api/debates/[id] - Get full debate status with participants, arguments, votes
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const debateId = parseInt(id, 10)
    if (isNaN(debateId)) {
      return NextResponse.json({ error: 'Invalid debate ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const result = getDebateStatus(db, debateId)
    if (!result) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    // Verify workspace ownership
    if (result.debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/debates/[id] error')
    return NextResponse.json({ error: 'Failed to fetch debate' }, { status: 500 })
  }
}
