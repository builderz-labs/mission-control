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

    // Preferred: call gateway RPC directly using spawn-style args (no shell). This is safe
    // and matches the OpenClaw CLI usage: openclaw gateway call sessions.send --params '<json>'
    const payload = { session: agent.session_key, message }

    try {
      const { stdout } = await runOpenClaw(
        ['gateway', 'call', 'sessions.send', '--params', JSON.stringify(payload)],
        { timeoutMs: 10000 }
      )

      db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
      return NextResponse.json({ success: true, session_key: agent.session_key, stdout: stdout.trim() })
    } catch (rpcErr: any) {
      const stderr = String(rpcErr?.stderr || rpcErr?.message || '')
      logger.warn({ err: rpcErr, agent: agent.name }, 'Gateway RPC sessions.send failed')

      // Fallback 1: Try using the OpenClaw 'agent' CLI to deliver the message directly.
      // This avoids depending on the gateway exposing sessions.send RPC or a separate clawdbot binary.
      try {
        const { stdout: agout } = await runOpenClaw(
          ['agent', '--to', agent.session_key, '--message', message, '--deliver'],
          { timeoutMs: 15000 }
        )
        db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
        return NextResponse.json({ success: true, session_key: agent.session_key, stdout: agout.trim() })
      } catch (agentErr: any) {
        logger.warn({ err: agentErr, agent: agent.name }, 'OpenClaw agent CLI fallback failed, will try clawdbot')

        // Try clawdbot local fallback (some installations expose sessions_send locally instead of RPC)
        const clawdbotCmd = `sessions_send("${agent.session_key}", ${JSON.stringify(message)})`
        try {
          const cb = await runClawdbot(['-c', clawdbotCmd], { timeoutMs: 10000 })
          if (cb && cb.code === 0) {
            db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)
            return NextResponse.json({ success: true, session_key: agent.session_key, stdout: cb.stdout.trim() })
          }
          // fallback failed with non-zero code
          logger.error({ err: cb }, 'clawdbot fallback returned non-zero')
          return NextResponse.json({ error: cb.stderr.trim() || 'Failed to send wake via clawdbot' }, { status: 500 })
        } catch (cbErr: any) {
          logger.error({ err: cbErr, rpcErr, agentErr }, 'All delivery methods failed: gateway RPC, openclaw agent CLI, and clawdbot')
          return NextResponse.json({ error: stderr || String(cbErr?.stderr || cbErr?.message || 'Unknown error') }, { status: 500 })
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
