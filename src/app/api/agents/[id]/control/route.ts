import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, logAuditEvent } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import type { Agent } from '@/lib/db'

type AgentAction = 'start' | 'stop' | 'restart'

const VALID_ACTIONS: AgentAction[] = ['start', 'stop', 'restart']

const ACTION_STATUS_MAP: Record<AgentAction, Agent['status']> = {
  start: 'idle',
  stop: 'offline',
  restart: 'idle',
}

/**
 * POST /api/agents/[id]/control - Start, stop, or restart an agent
 *
 * Body: { action: 'start' | 'stop' | 'restart' }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
    }

    const { action } = body as Record<string, unknown>

    if (typeof action !== 'string' || !(VALID_ACTIONS as string[]).includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }

    const validatedAction = action as AgentAction

    const db = getDatabase()
    const agent: Agent | undefined = isNaN(Number(id))
      ? (db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as Agent | undefined)
      : (db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as Agent | undefined)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const newStatus = ACTION_STATUS_MAP[validatedAction]
    const activityLabel = validatedAction.charAt(0).toUpperCase() + validatedAction.slice(1)

    db_helpers.updateAgentStatus(agent.name, newStatus, `Manual ${activityLabel}`, workspaceId)

    const ipAddress =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown'

    logAuditEvent({
      action: `agent_${validatedAction}`,
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'agent',
      target_id: agent.id,
      detail: { agent_name: agent.name, action: validatedAction, new_status: newStatus },
      ip_address: ipAddress,
    })

    const updatedAgent: Agent = {
      ...agent,
      status: newStatus,
      last_seen: Math.floor(Date.now() / 1000),
    }

    return NextResponse.json({ success: true, agent: updatedAgent, action: validatedAction })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/control error')
    return NextResponse.json({ error: 'Failed to control agent' }, { status: 500 })
  }
}
