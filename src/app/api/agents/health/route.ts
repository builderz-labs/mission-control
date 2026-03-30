import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  getHealthRecords,
  getAgentHealth,
  sweepAgentHealth,
  recordActivity,
  recordHeartbeat,
  recordTaskCompleted,
} from '@/lib/agent-health'

/**
 * GET /api/agents/health - Get health status for all agents or a specific agent
 * Query params: agent_id (optional), sweep (optional - triggers a fresh sweep)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agent_id')
    const doSweep = searchParams.get('sweep') === 'true'

    // Optionally run a fresh health sweep before returning data
    let sweepResult: { updated: number; unhealthy: string[] } | undefined
    if (doSweep) {
      sweepResult = sweepAgentHealth(workspaceId)
    }

    if (agentId) {
      const health = getAgentHealth(workspaceId, agentId)
      if (!health) {
        return NextResponse.json({ error: 'No health record for agent' }, { status: 404 })
      }
      return NextResponse.json({ health, sweep: sweepResult })
    }

    const records = getHealthRecords(workspaceId)
    return NextResponse.json({ health: records, sweep: sweepResult })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/health error')
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 })
  }
}

/**
 * POST /api/agents/health - Report health signals from agents
 * Body: { agent_id, signal_type: 'activity' | 'heartbeat' | 'task_completed', is_system? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { agent_id, signal_type, is_system } = body

    if (!agent_id || !signal_type) {
      return NextResponse.json(
        { error: 'agent_id and signal_type are required' },
        { status: 400 }
      )
    }

    switch (signal_type) {
      case 'activity':
        recordActivity(workspaceId, agent_id, !!is_system)
        break
      case 'heartbeat':
        recordHeartbeat(workspaceId, agent_id)
        break
      case 'task_completed':
        recordTaskCompleted(workspaceId, agent_id)
        break
      default:
        return NextResponse.json(
          { error: `Unknown signal_type: ${signal_type}` },
          { status: 400 }
        )
    }

    return NextResponse.json({ success: true, agent_id, signal_type })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/health error')
    return NextResponse.json({ error: 'Failed to record health signal' }, { status: 500 })
  }
}
