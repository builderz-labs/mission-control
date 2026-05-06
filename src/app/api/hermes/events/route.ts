import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import { getDatabase, db_helpers } from '@/lib/db'

/**
 * POST /api/hermes/events — Receive events from the Hermes Agent hook.
 *
 * The MC hook (installed at ~/.hermes/hooks/mission-control/) posts events
 * here for: session:start, session:end, agent:start, agent:end.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { event, session_id, source, timestamp, agent_name } = body
    const workspaceId = auth.user.workspace_id ?? 1

    if (!event) {
      return NextResponse.json({ error: 'event field is required' }, { status: 400 })
    }

    logger.info({ event, session_id, source, agent_name }, 'Hermes event received')

    // Store event in activity log
    db_helpers.logActivity(
      `hermes.${event}`,
      'session',
      0,
      agent_name || 'hermes',
      `Hermes ${event}: ${session_id || 'unknown'} via ${source || 'cli'}`,
      { session_id, source, timestamp, agent_name },
      workspaceId
    )

    // Broadcast to SSE clients
    eventBus.broadcast('session.updated', {
      source: 'hermes',
      event,
      session_id,
      hermes_source: source,
      timestamp: timestamp || new Date().toISOString(),
    })

    // Update agent status on agent lifecycle events
    if (event === 'agent:start' || event === 'agent:end') {
      const db = getDatabase()
      const agentName = agent_name || 'hermes'
      const status = event === 'agent:start' ? 'online' : 'idle'
      db.prepare(
        'UPDATE agents SET status = ?, updated_at = ? WHERE name = ? AND workspace_id = ?'
      ).run(status, Math.floor(Date.now() / 1000), agentName, workspaceId)
    }

    return NextResponse.json({ ok: true, event })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/hermes/events error')
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
