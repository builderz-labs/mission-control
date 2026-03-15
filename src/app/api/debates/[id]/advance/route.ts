import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { advanceDebatePhase } from '@/lib/debate-engine'

/**
 * POST /api/debates/[id]/advance - Advance debate to next phase
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const debateId = parseInt(id, 10)
    if (isNaN(debateId)) {
      return NextResponse.json({ error: 'Invalid debate ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify debate exists and belongs to workspace
    const debate = db.prepare('SELECT workspace_id FROM debates WHERE id = ?').get(debateId) as { workspace_id: number } | undefined
    if (!debate || debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    const result = advanceDebatePhase(db, debateId)

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to advance debate'
    if (message.includes('already ended') || message.includes('Cannot advance')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates/[id]/advance error')
    return NextResponse.json({ error: 'Failed to advance debate' }, { status: 500 })
  }
}
