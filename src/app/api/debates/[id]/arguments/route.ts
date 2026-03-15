import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { submitArgument, type DebateArgumentRow } from '@/lib/debate-engine'

const submitArgumentSchema = z.object({
  agentId: z.number().int().positive(),
  content: z.string().min(1).max(50_000),
  confidence: z.number().min(0).max(1),
})

/**
 * GET /api/debates/[id]/arguments - List arguments for a debate
 * Optional query params: round, phase
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

    // Verify debate exists and belongs to workspace
    const debate = db.prepare('SELECT workspace_id FROM debates WHERE id = ?').get(debateId) as { workspace_id: number } | undefined
    if (!debate || debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const round = url.searchParams.get('round')
    const phase = url.searchParams.get('phase')

    let query = 'SELECT * FROM debate_arguments WHERE debate_id = ?'
    const queryParams: (string | number)[] = [debateId]

    if (round) {
      query += ' AND round_number = ?'
      queryParams.push(parseInt(round, 10))
    }
    if (phase) {
      query += ' AND phase = ?'
      queryParams.push(phase)
    }

    query += ' ORDER BY round_number ASC, created_at ASC'

    const args = db.prepare(query).all(...queryParams) as DebateArgumentRow[]

    return NextResponse.json({ arguments: args })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/debates/[id]/arguments error')
    return NextResponse.json({ error: 'Failed to fetch arguments' }, { status: 500 })
  }
}

/**
 * POST /api/debates/[id]/arguments - Submit an argument
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

    const result = await validateBody(request, submitArgumentSchema)
    if ('error' in result) return result.error
    const { agentId, content, confidence } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify debate exists and belongs to workspace
    const debate = db.prepare('SELECT workspace_id FROM debates WHERE id = ?').get(debateId) as { workspace_id: number } | undefined
    if (!debate || debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    const arg = submitArgument(db, debateId, agentId, content, confidence)

    return NextResponse.json(arg, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to submit argument'
    if (message.includes('not found') || message.includes('not a participant') || message.includes('Cannot submit') || message.includes('already submitted') || message.includes('budget')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates/[id]/arguments error')
    return NextResponse.json({ error: 'Failed to submit argument' }, { status: 500 })
  }
}
