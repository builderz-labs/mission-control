import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { leaveConversation } from '@/lib/conversation-engine'

const schema = z.object({
  agentId: z.number().int().positive(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, schema)
  if ('error' in result) return result.error

  const resolvedParams = await params
  const workspaceId = auth.user.workspace_id ?? 1

  try {
    await leaveConversation(result.data.agentId, resolvedParams.id, workspaceId)
    return NextResponse.json({ status: 'completed' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to leave conversation'
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    logger.error({ err, conversationId: resolvedParams.id }, 'POST /api/conversations/[id]/leave error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
