import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { startGatewaySession } from '@/lib/sessions'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const agent = body.agent
    if (!agent || typeof agent !== 'string') {
      return NextResponse.json({ error: 'agent required' }, { status: 400 })
    }

    const session = startGatewaySession(agent, { model: body.model, chatType: body.chatType, channel: body.channel })
    if (!session) {
      return NextResponse.json({ error: 'Failed to start session' }, { status: 500 })
    }

    return NextResponse.json({ success: true, session })
  } catch (err: any) {
    logger.error({ err }, 'Sessions start API error')
    return NextResponse.json({ error: 'Failed to start session' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
