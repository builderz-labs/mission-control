import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getHandoffBrief, markHandoffConsumed } from '@/lib/handoffs'

/**
 * POST /api/handoffs/{id}/consume - Mark a brief as read by the receiving
 * agent, so it isn't re-injected into a later session. Idempotent: a
 * previously consumed brief is returned unchanged.
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
    const wsResult = requireWorkspaceId(auth.user)
    if (!('workspaceId' in wsResult)) return wsResult.response
    const { workspaceId } = wsResult
    const { id } = await params

    const existing = getHandoffBrief(id, workspaceId)
    if (!existing) {
      return NextResponse.json({ error: 'Handoff brief not found' }, { status: 404 })
    }

    const consumedBy = auth.user.agent_name || auth.user.display_name || auth.user.username || 'system'
    const brief = markHandoffConsumed(id, consumedBy, workspaceId)

    return NextResponse.json({ brief })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/handoffs/[id]/consume error')
    return NextResponse.json({ error: 'Failed to consume handoff' }, { status: 500 })
  }
}
