import { NextRequest, NextResponse } from 'next/server'
import { eventBus } from '@/lib/event-bus'
import { db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface IngestEvent {
  type: string
  agent_name: string
  timestamp?: number
  subsystem?: string
  [key: string]: unknown
}

interface IngestBody {
  events?: IngestEvent[]
  type?: string
  agent_name?: string
  timestamp?: number
  subsystem?: string
  [key: string]: unknown
}

/**
 * Validate API key from request headers.
 * Returns true if auth passes (key matches or no key is configured = dev mode).
 */
function isAuthorized(request: NextRequest): boolean {
  const configuredKey = process.env.MC_API_KEY
  if (!configuredKey) {
    // Dev mode: no key configured, allow all requests
    return true
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    return key === configuredKey
  }

  const xApiKey = request.headers.get('x-api-key')
  if (xApiKey) {
    return xApiKey === configuredKey
  }

  return false
}

/**
 * Validate a single event object.
 * Returns an error string if invalid, undefined if valid.
 */
function validateEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') {
    return 'Event must be an object'
  }
  const e = event as Record<string, unknown>

  if (typeof e.type !== 'string' || !e.type.startsWith('agent.')) {
    return 'Event type must be a string starting with "agent."'
  }
  if (typeof e.agent_name !== 'string' || e.agent_name.trim() === '') {
    return 'agent_name must be a non-empty string'
  }

  return undefined
}

/**
 * Process a single valid event: broadcast and perform side effects.
 */
function processEvent(event: IngestEvent): void {
  const { type, agent_name } = event

  // Broadcast via eventBus — cast needed because agent.* types are not in the static EventType union
  eventBus.broadcast(type as Parameters<typeof eventBus.broadcast>[0], event)

  try {
    switch (type) {
      case 'agent.heartbeat': {
        const status = event.status as string | undefined
        if (status) {
          db_helpers.updateAgentStatus(agent_name, status as Parameters<typeof db_helpers.updateAgentStatus>[1])
        }
        break
      }

      case 'agent.status_changed': {
        const newStatus = event.new_status as string | undefined
        if (newStatus) {
          db_helpers.updateAgentStatus(agent_name, newStatus as Parameters<typeof db_helpers.updateAgentStatus>[1])
        }
        break
      }

      case 'agent.trade_opened': {
        const symbol = (event.symbol as string | undefined) ?? 'unknown'
        db_helpers.logActivity(
          type,
          'agent',
          0,
          agent_name,
          `${agent_name} opened trade: ${symbol}`,
          event,
        )
        break
      }

      case 'agent.trade_closed': {
        const symbol = (event.symbol as string | undefined) ?? 'unknown'
        db_helpers.logActivity(
          type,
          'agent',
          0,
          agent_name,
          `${agent_name} closed trade: ${symbol}`,
          event,
        )
        break
      }

      case 'agent.trade_error': {
        const reason = (event.reason as string | undefined) ?? 'unknown error'
        db_helpers.logActivity(
          type,
          'agent',
          0,
          agent_name,
          `${agent_name} trade error: ${reason}`,
          event,
        )
        break
      }

      case 'agent.risk_alert': {
        const severity = event.severity as string | undefined
        const message = (event.message as string | undefined) ?? 'Risk alert'
        db_helpers.logActivity(
          type,
          'agent',
          0,
          agent_name,
          `${agent_name} risk alert (${severity ?? 'unknown'}): ${message}`,
          event,
        )
        if (severity === 'critical') {
          db_helpers.createNotification(
            'admin',
            'risk_alert',
            'Critical Risk Alert',
            `Agent ${agent_name}: ${message}`,
            'agent',
            0,
          )
        }
        break
      }

      case 'agent.log': {
        const level = event.level as string | undefined
        if (level === 'error') {
          const message = (event.message as string | undefined) ?? 'Agent error'
          db_helpers.logActivity(
            type,
            'agent',
            0,
            agent_name,
            `${agent_name} error: ${message}`,
            event,
          )
        }
        break
      }

      default:
        // No additional side effects for other agent.* types
        break
    }
  } catch (err) {
    logger.error({ err, type, agent_name }, 'Event side-effect failed')
    // Don't rethrow — broadcast already succeeded; side effects are best-effort
  }
}

/**
 * POST /api/events/ingest
 *
 * Accepts events from Python trading agents and routes them through the event bus.
 * Supports single-event and batch (events array) payloads.
 *
 * Authentication:
 *   - Bearer token via Authorization header, or x-api-key header
 *   - Compared against MC_API_KEY env var
 *   - If MC_API_KEY is unset, all requests are allowed (dev mode)
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IngestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // --- Batch mode ---
  if (Array.isArray(body.events)) {
    const errors: Array<{ index: number; error: string }> = []
    let processed = 0

    for (let i = 0; i < body.events.length; i++) {
      const raw = body.events[i]
      const validationError = validateEvent(raw)
      if (validationError) {
        errors.push({ index: i, error: validationError })
        continue
      }
      processEvent(raw as IngestEvent)
      processed++
    }

    return NextResponse.json({ success: true, processed, errors })
  }

  // --- Single event mode ---
  const validationError = validateEvent(body)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const event: IngestEvent = {
    type: body.type as string,
    agent_name: body.agent_name as string,
    ...(body.timestamp !== undefined && { timestamp: body.timestamp }),
    ...(body.subsystem !== undefined && { subsystem: body.subsystem }),
    ...body,
  }

  processEvent(event)

  return NextResponse.json({ success: true, event_type: event.type })
}
