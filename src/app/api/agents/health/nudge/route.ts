import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { nudgeAgent, autoNudgeUnhealthyAgents } from '@/lib/agent-nudge'

/**
 * POST /api/agents/health/nudge - Nudge an agent or auto-nudge all unhealthy agents
 * Body: { agent_id?: string, message?: string, auto?: boolean }
 *
 * If auto=true, nudges all eligible stuck/zombie agents.
 * If agent_id is provided, nudges that specific agent.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))
    const { agent_id, message, auto } = body

    if (auto) {
      const result = await autoNudgeUnhealthyAgents(workspaceId)
      return NextResponse.json(result)
    }

    if (!agent_id) {
      return NextResponse.json(
        { error: 'agent_id is required (or set auto=true for bulk nudge)' },
        { status: 400 }
      )
    }

    const result = await nudgeAgent(workspaceId, agent_id, message)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({ success: true, agent_id })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/health/nudge error')
    return NextResponse.json({ error: 'Failed to nudge agent' }, { status: 500 })
  }
}
