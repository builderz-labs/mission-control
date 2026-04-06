import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
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
    type AgentRow = { id: number; name: string; role: string; session_key: string | null; status: string; last_seen: number | null; last_activity: string | null; created_at: number; updated_at: number; config: string | null; workspace_id: number; source: string | null; content_hash: string | null; workspace_path: string | null }
    const agent = (isNaN(Number(agentId))
      ? db.prepare('SELECT id, name, role, session_key, status, last_seen, last_activity, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
      : db.prepare('SELECT id, name, role, session_key, status, last_seen, last_activity, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId)) as AgentRow | undefined

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

    const { stdout, stderr } = await runOpenClaw(
      ['gateway', 'sessions_send', '--session', agent.session_key, '--message', message],
      { timeoutMs: 10000 }
    )

    if (stderr && stderr.includes('error')) {
      return NextResponse.json(
        { error: stderr.trim() || 'Failed to wake agent' },
        { status: 500 }
      )
    }

    db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)

    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      stdout: stdout.trim()
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
