import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createDebate } from '@/lib/debate-engine'

const schema = z.object({
  topic: z.string().min(1).max(1000),
  participantIds: z.array(z.number().int().positive()).min(2).max(10),
  maxRounds: z.number().int().min(1).max(20).optional(),
  tokenBudget: z.number().int().min(100).max(1_000_000).optional(),
})

/**
 * POST /api/debates/start - Start a new debate (backward-compatible)
 *
 * Delegates to debate-engine.createDebate instead of conversation-engine.startDebate.
 * Returns { debate: { id, topic, status } } for backward compatibility.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, schema)
  if ('error' in result) return result.error

  const body = result.data
  const workspaceId = auth.user.workspace_id ?? 1
  const createdBy = auth.user.username || 'system'

  try {
    const db = getDatabase()
    const { debateId } = createDebate(
      db,
      body.topic,
      body.participantIds,
      body.maxRounds ?? 3,
      body.tokenBudget ?? 10_000,
      createdBy,
      workspaceId
    )

    return NextResponse.json({
      debate: { id: debateId, topic: body.topic, status: 'propose' },
    }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start debate'
    if (message.includes('not found') || message.includes('requires')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates/start error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
