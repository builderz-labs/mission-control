import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { castVote } from '@/lib/debate-engine'

const voteSchema = z.object({
  agentId: z.number().int().positive(),
  vote: z.enum(['accept', 'reject']),
  reason: z.string().max(5000).optional(),
})

/**
 * POST /api/debates/[id]/vote - Cast a vote on a debate
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

    const result = await validateBody(request, voteSchema)
    if ('error' in result) return result.error
    const { agentId, vote, reason } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify debate exists and belongs to workspace
    const debate = db.prepare('SELECT workspace_id FROM debates WHERE id = ?').get(debateId) as { workspace_id: number } | undefined
    if (!debate || debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    const voteResult = castVote(db, debateId, agentId, vote, reason)

    return NextResponse.json(voteResult, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cast vote'
    if (message.includes('not found') || message.includes('not a participant') || message.includes('not in voting')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates/[id]/vote error')
    return NextResponse.json({ error: 'Failed to cast vote' }, { status: 500 })
  }
}
