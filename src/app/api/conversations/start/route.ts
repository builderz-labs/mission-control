import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { startConversation } from '@/lib/conversation-engine'

const schema = z.object({
  initiatorId: z.number().int().positive(),
  targetId: z.number().int().positive(),
  topic: z.string().min(1).max(1000),
  config: z.object({
    maxMessages: z.number().int().min(1).max(100).optional(),
    maxDurationMs: z.number().int().min(1000).max(3600000).optional(),
    consensusKeyword: z.string().optional(),
    maxHops: z.number().int().min(1).max(50).optional(),
    needReflect: z.boolean().optional(),
  }).optional(),
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
    const conversationId = await startConversation(
      body.initiatorId, body.targetId, body.topic, workspaceId, body.config,
    )
    return NextResponse.json({ conversationId }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start conversation'
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    logger.error({ err }, 'POST /api/conversations/start error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
