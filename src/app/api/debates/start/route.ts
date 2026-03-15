import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { startDebate } from '@/lib/conversation-engine'

const schema = z.object({
  topic: z.string().min(1).max(1000),
  participantIds: z.array(z.number().int().positive()).min(2).max(10),
  maxCycles: z.number().int().min(1).max(20).optional(),
  breakKeyword: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, schema)
  if ('error' in result) return result.error

  const body = result.data
  const workspaceId = auth.user.workspace_id ?? 1

  try {
    const outcome = await startDebate(body.topic, body.participantIds, workspaceId, {
      maxCycles: body.maxCycles,
      breakCondition: body.breakKeyword ? { type: 'keyword', keyword: body.breakKeyword } : undefined,
    })
    return NextResponse.json(outcome, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start debate'
    if (message.includes('not found') || message.includes('requires')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates/start error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
