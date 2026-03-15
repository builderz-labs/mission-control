import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getConversation } from '@/lib/conversation-engine'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params

  try {
    const conversation = getConversation(resolvedParams.id)
    if (!conversation.state) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json(conversation)
  } catch (err) {
    logger.error({ err, conversationId: resolvedParams.id }, 'GET /api/conversations/[id] error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
