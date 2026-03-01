import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { validateBody, createMessageSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createMessageSchema)
    if ('error' in result) return result.error
    const { from, to, message } = result.data

    const db = getDatabase()
    const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(to) as any
    if (!agent) {
      return NextResponse.json({ error: 'Recipient agent not found' }, { status: 404 })
    }
    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Recipient agent has no session key configured' },
        { status: 400 }
      )
    }

    await runOpenClaw(
      [
        'gateway',
        'sessions_send',
        '--session',
        agent.session_key,
        '--message',
        `Message from ${from}: ${message}`
      ],
      { timeoutMs: 10000 }
    )

    db_helpers.createNotification(
      to,
      'message',
      'Direct Message',
      `${from}: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`,
      'agent',
      agent.id
    )

    db_helpers.logActivity(
      'agent_message',
      'agent',
      agent.id,
      from,
      `Sent message to ${to}`,
      { to }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('POST /api/agents/message error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
