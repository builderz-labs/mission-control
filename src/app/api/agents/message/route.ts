import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw, runClawdbot } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { validateBody, createMessageSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createMessageSchema)
    if ('error' in result) return result.error
    const { to, message } = result.data
    const from = auth.user.display_name || auth.user.username || 'system'

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1;
    const agent = db
      .prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?')
      .get(to, workspaceId) as any
    if (!agent) {
      return NextResponse.json({ error: 'Recipient agent not found' }, { status: 404 })
    }
    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Recipient agent has no session key configured' },
        { status: 400 }
      )
    }

    // Try local clawdbot first (some environments deliver sessions via local runtime):
    const payload = { session: agent.session_key, message: `Message from ${from}: ${message}` }
    let sessionDeliveryFailed = false
    try {
      const cb = await runClawdbot(['sessions_send', agent.session_key, payload.message], { timeoutMs: 5000 })
      if (!cb || cb.code !== 0) {
        throw new Error('clawdbot failed')
      }
    } catch (err) {
      // Fallback to gateway RPC
      try {
        await runOpenClaw(
          [
            'gateway', 'call', 'sessions.send',
            '--params', JSON.stringify(payload),
          ],
          { timeoutMs: 5000 }
        )
      } catch (rpcErr: any) {
        // Both delivery methods unavailable — the notification will still be stored in the DB.
        sessionDeliveryFailed = true
        logger.warn({ err: rpcErr, agent: to }, 'Session delivery failed; message stored as notification only')
      }
    }

    db_helpers.createNotification(
      to,
      'message',
      'Direct Message',
      `${from}: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`,
      'agent',
      agent.id,
      workspaceId
    )

    db_helpers.logActivity(
      'agent_message',
      'agent',
      agent.id,
      from,
      `Sent message to ${to}`,
      { to },
      workspaceId
    )

    return NextResponse.json({
      success: true,
      ...(sessionDeliveryFailed && { delivery_warning: 'Session delivery unavailable; message stored as notification' }),
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/message error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
