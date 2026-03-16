import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { db_helpers } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

// Only allow alphanumeric, hyphens, and underscores in session IDs
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

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
    const { action } = await request.json()

    if (!SESSION_ID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      )
    }

    if (!['monitor', 'pause', 'terminate'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: monitor, pause, terminate' },
        { status: 400 }
      )
    }

    let result: unknown
    if (action === 'terminate') {
      result = await callOpenClawGateway('sessions_kill', { sessionKey: id }, 10_000)
    } else {
      const message = action === 'monitor'
        ? { type: 'control', action: 'monitor' }
        : { type: 'control', action: 'pause' }
      result = await callOpenClawGateway('sessions_send', { sessionKey: id, message }, 10_000)
    }

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Session ${action}: ${id}`,
      { session_key: id, action }
    )

    return NextResponse.json({
      success: true,
      action,
      session: id,
      result,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'Session control error')
    return NextResponse.json(
      { error: error.message || 'Session control failed' },
      { status: 500 }
    )
  }
}
