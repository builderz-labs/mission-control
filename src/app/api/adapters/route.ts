import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getAdapter, listAdapters } from '@/lib/adapters'
import { agentHeartbeatLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * GET /api/adapters — List available framework adapters.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ adapters: listAdapters() })
}

/**
 * POST /api/adapters — Framework-agnostic agent action dispatcher.
 *
 * Body: { framework, action, payload }
 *
 * Actions:
 *   register   — Register an agent via its framework adapter
 *   heartbeat  — Send a heartbeat/status update
 *   report     — Report task progress
 *   assignments — Get pending task assignments
 *   disconnect — Disconnect an agent
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateLimited = agentHeartbeatLimiter(request)
  if (rateLimited) return rateLimited

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const framework = typeof body?.framework === 'string' ? body.framework.trim() : ''
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const payload = body?.payload ?? {}
  const workspaceId = auth.user.workspace_id ?? 1

  if (!framework || !action) {
    return NextResponse.json({ error: 'framework and action are required' }, { status: 400 })
  }

  let adapter
  try {
    adapter = getAdapter(framework)
  } catch {
    return NextResponse.json({
      error: `Unknown framework: ${framework}. Available: ${listAdapters().join(', ')}`,
    }, { status: 400 })
  }

  try {
    switch (action) {
      case 'register': {
        const { agentId, name, metadata } = payload
        if (!agentId || !name) {
          return NextResponse.json({ error: 'payload.agentId and payload.name required' }, { status: 400 })
        }
        await adapter.register({ agentId, name, framework, metadata, workspaceId })
        return NextResponse.json({ ok: true, action: 'register', framework })
      }

      case 'heartbeat': {
        const { agentId, status, metrics } = payload
        if (!agentId) {
          return NextResponse.json({ error: 'payload.agentId required' }, { status: 400 })
        }
        await adapter.heartbeat({ agentId, status: status || 'online', metrics, workspaceId })
        return NextResponse.json({ ok: true, action: 'heartbeat', framework })
      }

      case 'report': {
        const { taskId, agentId, progress, status: taskStatus, output } = payload
        if (!taskId || !agentId) {
          return NextResponse.json({ error: 'payload.taskId and payload.agentId required' }, { status: 400 })
        }
        await adapter.reportTask({ taskId, agentId, progress: progress ?? 0, status: taskStatus || 'in_progress', output, workspaceId })
        return NextResponse.json({ ok: true, action: 'report', framework })
      }

      case 'assignments': {
        const { agentId } = payload
        if (!agentId) {
          return NextResponse.json({ error: 'payload.agentId required' }, { status: 400 })
        }
        const assignments = await adapter.getAssignments(agentId, workspaceId)
        return NextResponse.json({ assignments, framework })
      }

      case 'disconnect': {
        const { agentId } = payload
        if (!agentId) {
          return NextResponse.json({ error: 'payload.agentId required' }, { status: 400 })
        }
        await adapter.disconnect(agentId, workspaceId)
        return NextResponse.json({ ok: true, action: 'disconnect', framework })
      }

      default:
        return NextResponse.json({
          error: `Unknown action: ${action}. Use: register, heartbeat, report, assignments, disconnect`,
        }, { status: 400 })
    }
  } catch (error) {
    logger.error({ err: error, framework, action }, 'POST /api/adapters error')
    return NextResponse.json({ error: 'Adapter action failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
