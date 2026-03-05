import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw, runClawdbot } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}))
    const customMessage =
      typeof body?.message === 'string' ? body.message.trim() : ''

    const db = getDatabase()
    const agent: any = isNaN(Number(agentId))
      ? db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
      : db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Agent has no session key configured' },
        { status: 400 }
      )
    }

    const message =
      customMessage ||
      `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`

    const payload = { session: agent.session_key, message }

    // Try clawdbot sessions_send first (local delivery, no gateway dependency),
    // then fall back to gateway RPC. If both fail, still complete the wake action
    // (update agent status) so the core operation succeeds regardless of delivery.
    let deliveryWarning: string | undefined

    try {
      const cb = await runClawdbot(['sessions_send', agent.session_key, message], { timeoutMs: 5000 })
      if (!cb || cb.code !== 0) {
        throw new Error('clawdbot returned non-zero')
      }
    } catch (cbErr: any) {
      logger.warn({ err: cbErr, agent: agent.name }, 'clawdbot sessions_send failed, falling back to gateway RPC')

      // Fallback: gateway RPC sessions.send
      try {
        await runOpenClaw(
          ['gateway', 'call', 'sessions.send', '--params', JSON.stringify(payload)],
          { timeoutMs: 5000 }
        )
      } catch (rpcErr: any) {
        const detail = String(rpcErr?.stderr || rpcErr?.message || 'unknown error')
        logger.warn({ err: rpcErr, agent: agent.name }, 'Gateway RPC sessions.send also failed; completing wake without session delivery')
        deliveryWarning = `Session message delivery unavailable: ${detail}`
      }
    }

    // Always update agent status — the wake action succeeds even when delivery is unavailable.
    db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      ...(deliveryWarning && { delivery_warning: deliveryWarning }),
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
