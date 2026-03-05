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
    // then fall back to gateway RPC if clawdbot is unavailable.
    try {
      const cb = await runClawdbot(['sessions_send', agent.session_key, message], { timeoutMs: 10000 })
      if (!cb || cb.code !== 0) {
        throw new Error('clawdbot returned non-zero')
      }
      db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
      return NextResponse.json({ success: true, session_key: agent.session_key, stdout: cb.stdout.trim() })
    } catch (cbErr: any) {
      logger.warn({ err: cbErr, agent: agent.name }, 'clawdbot sessions_send failed, falling back to gateway RPC')
    }

    // Fallback: gateway RPC sessions.send
    try {
      const { stdout } = await runOpenClaw(
        ['gateway', 'call', 'sessions.send', '--params', JSON.stringify(payload)],
        { timeoutMs: 10000 }
      )
      db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
      return NextResponse.json({ success: true, session_key: agent.session_key, stdout: stdout.trim() })
    } catch (rpcErr: any) {
      const stderr = String(rpcErr?.stderr || rpcErr?.message || '')
      logger.error({ err: rpcErr, agent: agent.name }, 'All delivery methods failed for wake')
      return NextResponse.json({ error: stderr || 'Failed to wake agent' }, { status: 500 })
    }
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
