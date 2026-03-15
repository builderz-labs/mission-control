import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  type DebateRow,
  type DebateArgumentRow,
  type DebateVoteRow,
} from '@/lib/debate-engine'

/**
 * GET /api/debates/[id]/results - Get debate results (outcome, vote tally, arguments by round)
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

    const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow | undefined
    if (!debate || debate.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    // Vote tally
    const votes = db.prepare(
      'SELECT * FROM debate_votes WHERE debate_id = ? ORDER BY created_at ASC'
    ).all(debateId) as DebateVoteRow[]

    const voteTally = {
      accept: votes.filter(v => v.vote === 'accept').length,
      reject: votes.filter(v => v.vote === 'reject').length,
      total: votes.length,
    }

    // Arguments grouped by round
    const args = db.prepare(
      'SELECT * FROM debate_arguments WHERE debate_id = ? ORDER BY round_number ASC, created_at ASC'
    ).all(debateId) as DebateArgumentRow[]

    const argumentsByRound: Record<number, DebateArgumentRow[]> = {}
    for (const arg of args) {
      if (!argumentsByRound[arg.round_number]) {
        argumentsByRound[arg.round_number] = []
      }
      argumentsByRound[arg.round_number].push(arg)
    }

    return NextResponse.json({
      debate: {
        id: debate.id,
        topic: debate.topic,
        status: debate.status,
        outcome: debate.outcome,
        current_round: debate.current_round,
        max_rounds: debate.max_rounds,
        tokens_used: debate.tokens_used,
        token_budget: debate.token_budget,
        concluded_at: debate.concluded_at,
      },
      voteTally,
      votes,
      argumentsByRound,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/debates/[id]/results error')
    return NextResponse.json({ error: 'Failed to fetch debate results' }, { status: 500 })
  }
}
