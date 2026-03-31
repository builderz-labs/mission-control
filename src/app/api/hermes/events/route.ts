import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

type HermesHookEvent = 'agent:start' | 'agent:end' | 'session:start'

interface HermesEventPayload {
  event?: string
  payload?: Record<string, unknown>
  timestamp?: string
}

function normalizeEventName(value: unknown): HermesHookEvent | null {
  const eventName = String(value || '').trim()
  if (eventName === 'agent:start' || eventName === 'agent:end' || eventName === 'session:start') {
    return eventName
  }
  return null
}

function upsertHermesAgentStatus(agentName: string, status: 'active' | 'idle', workspaceId: number): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const existing = db.prepare(
    'SELECT id, name FROM agents WHERE name = ? AND workspace_id = ? LIMIT 1'
  ).get(agentName, workspaceId) as { id: number; name: string } | undefined

  if (existing) {
    db.prepare(
      'UPDATE agents SET status = ?, last_seen = ?, last_activity = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
    ).run(status, now, `Hermes hook ${status}`, now, existing.id, workspaceId)
    return existing.id
  }

  const result = db.prepare(`
    INSERT INTO agents (name, role, status, source, last_seen, last_activity, workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agentName, 'Hermes Agent', status, 'hermes-hook', now, `Hermes hook ${status}`, workspaceId, now, now)

  return Number(result.lastInsertRowid)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HermesEventPayload
    const eventName = normalizeEventName(body.event)
    if (!eventName) {
      return NextResponse.json({ error: 'Invalid Hermes event' }, { status: 400 })
    }

    const workspaceId = 1
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
    const actor = String(payload.agent_name || 'hermes')
    const source = String(payload.source || 'hermes-hook')
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString()

    if (eventName === 'agent:start' || eventName === 'agent:end') {
      const status = eventName === 'agent:start' ? 'active' : 'idle'
      const agentId = upsertHermesAgentStatus(actor, status, workspaceId)

      db_helpers.logActivity(
        'hermes_hook_event',
        'agent',
        agentId,
        actor,
        `Hermes hook reported ${eventName}`,
        { event: eventName, source, timestamp },
        workspaceId,
      )

      eventBus.broadcast('activity.created', {
        type: 'hermes_hook_event',
        entity_type: 'agent',
        entity_id: agentId,
        actor,
        description: `Hermes hook reported ${eventName}`,
        data: { event: eventName, source, timestamp },
        workspace_id: workspaceId,
      })

      return NextResponse.json({ ok: true, event: eventName, agentId })
    }

    db_helpers.logActivity(
      'hermes_hook_event',
      'session',
      0,
      actor,
      `Hermes hook reported ${eventName}`,
      {
        event: eventName,
        source,
        session_id: String(payload.session_id || ''),
        timestamp,
      },
      workspaceId,
    )

    eventBus.broadcast('activity.created', {
      type: 'hermes_hook_event',
      entity_type: 'session',
      entity_id: 0,
      actor,
      description: `Hermes hook reported ${eventName}`,
      data: {
        event: eventName,
        source,
        session_id: String(payload.session_id || ''),
        timestamp,
      },
      workspace_id: workspaceId,
    })

    return NextResponse.json({ ok: true, event: eventName })
  } catch (err) {
    logger.error({ err }, 'Failed to ingest Hermes hook event')
    return NextResponse.json({ error: 'Failed to ingest Hermes hook event' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
