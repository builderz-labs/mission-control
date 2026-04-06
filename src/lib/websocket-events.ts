'use client'

// ---------------------------------------------------------------------------
// WebSocket — gateway message and broadcast event dispatch
// ---------------------------------------------------------------------------
import { type GatewayFrame, type GatewayMessage } from './websocket-types'
import type { JsonValue } from '../store/shared-types'
import { type Session, type LogEntry, type CronJob, type TokenUsage, type ChatMessage, type Notification } from '@/index'
import { type ExecApprovalRequest } from '@/store/slices/task-slice'
import { normalizeModel } from '@/lib/utils'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('WebSocket')

// Narrow a JsonValue to a plain object; returns null for primitives/arrays.
function asObj(v: JsonValue | undefined): Record<string, JsonValue | undefined> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, JsonValue | undefined>
  }
  return null
}

// Safely read a string field from a JsonValue object.
function str(obj: Record<string, JsonValue | undefined>, key: string): string {
  const v = obj[key]
  return typeof v === 'string' ? v : ''
}

// Safely read a number field from a JsonValue object.
function num(obj: Record<string, JsonValue | undefined>, key: string, fallback = 0): number {
  const v = obj[key]
  return typeof v === 'number' ? v : fallback
}

// ---------------------------------------------------------------------------
// Action interfaces (subset of useMissionControl store actions)
// ---------------------------------------------------------------------------

export interface GatewayMessageActions {
  setLastMessage: (msg: GatewayMessage) => void
  setSessions: (sessions: Session[]) => void
  addLog: (entry: LogEntry) => void
  updateSpawnRequest: (id: string, data: Record<string, unknown>) => void
  setCronJobs: (jobs: CronJob[]) => void
  addTokenUsage: (usage: TokenUsage) => void
}

export interface BroadcastEventActions {
  setSessions: (sessions: Session[]) => void
  addLog: (entry: LogEntry) => void
  addChatMessage: (msg: ChatMessage) => void
  addNotification: (notif: Omit<Notification, 'id'> & { id: number }) => void
  updateAgent: (id: number, data: Record<string, unknown>) => void
  addExecApproval: (approval: ExecApprovalRequest) => void
  updateExecApproval: (id: string, data: Partial<ExecApprovalRequest>) => void
}

// ---------------------------------------------------------------------------
// handleGatewayMessage — legacy message format handler
// ---------------------------------------------------------------------------

export function handleGatewayMessage(
  message: GatewayMessage,
  actions: GatewayMessageActions,
): void {
  actions.setLastMessage(message)

  if (process.env.NODE_ENV === 'development') {
    log.debug(`Message received: ${message.type}`)
  }

  const d = asObj(message.data)

  switch (message.type) {
    case 'session_update': {
      const sessionsRaw = d ? d['sessions'] : undefined
      if (Array.isArray(sessionsRaw)) {
        actions.setSessions(sessionsRaw.map((rawSession, index) => {
          const session = asObj(rawSession as JsonValue) ?? {}
          return {
            id: str(session, 'key') || `session-${index}`,
            key: str(session, 'key'),
            kind: str(session, 'kind') || 'unknown',
            age: str(session, 'age'),
            model: normalizeModel(str(session, 'model')),
            tokens: str(session, 'tokens'),
            flags: [],
            active: session['active'] === true,
            startTime: typeof session['startTime'] === 'number' ? session['startTime'] : undefined,
            lastActivity: typeof session['lastActivity'] === 'number' ? session['lastActivity'] : undefined,
            messageCount: typeof session['messageCount'] === 'number' ? session['messageCount'] : undefined,
            cost: typeof session['cost'] === 'number' ? session['cost'] : undefined,
          }
        }))
      }
      break
    }

    case 'log':
      if (d) {
        actions.addLog({
          id: str(d, 'id') || `log-${Date.now()}-${Math.random()}`,
          timestamp: num(d, 'timestamp') || message.timestamp as number || Date.now(),
          level: (str(d, 'level') as LogEntry['level']) || 'info',
          source: str(d, 'source') || 'gateway',
          session: str(d, 'session') || undefined,
          message: str(d, 'message'),
          data: d['extra'] ?? d['data'],
        })
      }
      break

    case 'spawn_result': {
      const spawnId = d ? str(d, 'id') : ''
      if (spawnId) {
        actions.updateSpawnRequest(spawnId, {
          status: d ? str(d, 'status') : undefined,
          completedAt: d ? (typeof d['completedAt'] === 'number' ? d['completedAt'] : undefined) : undefined,
          result: d ? str(d, 'result') : undefined,
          error: d ? str(d, 'error') : undefined,
        })
      }
      break
    }

    case 'cron_status': {
      const jobsRaw = d ? d['jobs'] : undefined
      if (Array.isArray(jobsRaw)) {
        actions.setCronJobs(jobsRaw as unknown as CronJob[])
      }
      break
    }

    case 'event':
      if (d && str(d, 'type') === 'token_usage') {
        actions.addTokenUsage({
          model: normalizeModel(str(d, 'model')),
          sessionId: str(d, 'sessionId'),
          date: new Date().toISOString(),
          inputTokens: num(d, 'inputTokens'),
          outputTokens: num(d, 'outputTokens'),
          totalTokens: num(d, 'totalTokens'),
          cost: num(d, 'cost'),
        })
      }
      break

    default:
      log.warn(`Unknown gateway message type: ${message.type}`)
  }
}

// ---------------------------------------------------------------------------
// dispatchBroadcastEvent — handles frame.type === 'event' branch
// ---------------------------------------------------------------------------

export function dispatchBroadcastEvent(
  frame: GatewayFrame,
  refs: { lastSeq: { current: number | null } },
  actions: BroadcastEventActions,
): void {
  // Track event sequence numbers to detect gaps (missed events)
  const seq = typeof frame.seq === 'number' ? frame.seq : null
  if (seq !== null) {
    if (refs.lastSeq.current !== null && seq > refs.lastSeq.current + 1) {
      log.warn(`Event sequence gap: expected ${refs.lastSeq.current + 1}, received ${seq}`)
    }
    refs.lastSeq.current = seq
  }

  const p = asObj(frame.payload)

  if (frame.event === 'tick') {
    const snapshot = p ? asObj(p['snapshot']) : null
    const sessionsRaw = snapshot ? snapshot['sessions'] : undefined
    if (Array.isArray(sessionsRaw)) {
      actions.setSessions(sessionsRaw.map((rawSession, index) => {
        const session = asObj(rawSession as JsonValue) ?? {}
        const updatedAt = num(session, 'updatedAt')
        return {
          id: str(session, 'key') || `session-${index}`,
          key: str(session, 'key'),
          kind: str(session, 'kind') || 'unknown',
          age: formatAge(updatedAt),
          model: normalizeModel(str(session, 'model')),
          tokens: `${num(session, 'totalTokens')}/${num(session, 'contextTokens') || 35000}`,
          flags: [],
          active: isSessionActive(updatedAt),
          startTime: updatedAt,
          lastActivity: updatedAt,
          messageCount: typeof session['messageCount'] === 'number' ? session['messageCount'] : undefined,
          cost: typeof session['cost'] === 'number' ? session['cost'] : undefined,
        }
      }))
    }
  } else if (frame.event === 'log') {
    if (p) {
      actions.addLog({
        id: str(p, 'id') || `log-${Date.now()}-${Math.random()}`,
        timestamp: num(p, 'timestamp') || Date.now(),
        level: (str(p, 'level') as LogEntry['level']) || 'info',
        source: str(p, 'source') || 'gateway',
        session: str(p, 'session') || undefined,
        message: str(p, 'message'),
        data: p['extra'] ?? p['data'],
      })
    }
  } else if (frame.event === 'chat.message') {
    if (p) {
      actions.addChatMessage({
        id: num(p, 'id'),
        conversation_id: str(p, 'conversation_id'),
        from_agent: str(p, 'from_agent'),
        to_agent: str(p, 'to_agent') || null,
        content: str(p, 'content'),
        message_type: (str(p, 'message_type') as ChatMessage['message_type']) || 'text',
        metadata: p['metadata'],
        read_at: typeof p['read_at'] === 'number' ? p['read_at'] : undefined,
        created_at: num(p, 'created_at') || Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'notification') {
    if (p) {
      actions.addNotification({
        id: num(p, 'id'),
        recipient: str(p, 'recipient') || 'operator',
        type: str(p, 'type') || 'info',
        title: str(p, 'title'),
        message: str(p, 'message'),
        source_type: str(p, 'source_type') || undefined,
        source_id: typeof p['source_id'] === 'number' ? p['source_id'] : undefined,
        created_at: num(p, 'created_at') || Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'agent.status') {
    const agentId = p ? num(p, 'id') : 0
    if (agentId) {
      actions.updateAgent(agentId, {
        status: p ? str(p, 'status') : undefined,
        last_seen: p ? (typeof p['last_seen'] === 'number' ? p['last_seen'] : undefined) : undefined,
        last_activity: p ? str(p, 'last_activity') || undefined : undefined,
      })
    }
  } else if (frame.event === 'tool.stream') {
    if (p) {
      actions.addChatMessage({
        id: num(p, 'id') || -(Date.now() + Math.random()),
        conversation_id: str(p, 'conversation_id') || str(p, 'sessionId') || 'tool-stream',
        from_agent: str(p, 'agentName') || str(p, 'agent') || 'agent',
        to_agent: null,
        content: '',
        message_type: 'tool_call',
        metadata: {
          toolName: str(p, 'toolName') || str(p, 'name'),
          toolArgs: p['args'] ?? p['toolArgs'],
          toolOutput: p['output'] ?? p['toolOutput'],
          toolStatus: str(p, 'status') || 'success',
          durationMs: typeof p['durationMs'] === 'number' ? p['durationMs'] : undefined,
        },
        created_at: typeof p['timestamp'] === 'number'
          ? Math.floor(p['timestamp'] / 1000)
          : Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'context.compaction') {
    actions.addNotification({
      id: Date.now(),
      recipient: 'operator',
      type: 'info',
      title: 'Context Compaction',
      message: (p ? str(p, 'message') : '') ||
        `Session context compacted (${p ? str(p, 'percentage') || '?' : '?'}% reduced)`,
      created_at: Math.floor(Date.now() / 1000),
    })
  } else if (frame.event === 'model.fallback') {
    actions.addNotification({
      id: Date.now(),
      recipient: 'operator',
      type: 'warning',
      title: 'Model Fallback',
      message: (p ? str(p, 'message') : '') ||
        `Fell back from ${p ? str(p, 'from') || '?' : '?'} to ${p ? str(p, 'to') || '?' : '?'}`,
      created_at: Math.floor(Date.now() / 1000),
    })
  } else if (frame.event === 'exec.approval' || frame.event === 'exec.approval.requested') {
    // Supports both event name variants
    const requestRaw = p ? p['request'] : undefined
    const request = asObj(requestRaw as JsonValue)
    const approvalId = p ? str(p, 'id') : ''
    if (approvalId && p) {
      actions.addExecApproval({
        id: approvalId,
        sessionId: (request ? str(request, 'sessionKey') : '') || str(p, 'sessionId'),
        agentName: (request ? str(request, 'agentId') : '') || str(p, 'agentName') || undefined,
        toolName: str(p, 'toolName') || str(p, 'name') || (request ? str(request, 'command') : '') || 'unknown',
        toolArgs: (p['args'] ?? p['toolArgs'] ?? {}) as Record<string, unknown>,
        command: (request ? str(request, 'command') : '') || str(p, 'command') || undefined,
        cwd: (request ? str(request, 'cwd') : '') || str(p, 'cwd') || undefined,
        host: (request ? str(request, 'host') : '') || str(p, 'host') || undefined,
        resolvedPath: (request ? str(request, 'resolvedPath') : '') || str(p, 'resolvedPath') || undefined,
        risk: (str(p, 'risk') as ExecApprovalRequest['risk']) || 'medium',
        createdAt: num(p, 'createdAtMs') || num(p, 'createdAt') || Date.now(),
        expiresAt: num(p, 'expiresAtMs') || num(p, 'expiresAt') || undefined,
        status: 'pending',
      })
      actions.addNotification({
        id: Date.now(),
        recipient: 'operator',
        type: 'warning',
        title: 'Exec Approval Required',
        message: `${(request ? str(request, 'agentId') : '') || str(p, 'agentName') || 'Agent'} wants to run: ${(request ? str(request, 'command') : '') || str(p, 'toolName') || str(p, 'name') || 'tool'}`,
        created_at: Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'exec.approval.resolved') {
    const resolvedId = p ? str(p, 'id') : ''
    if (resolvedId && p) {
      const newStatus = str(p, 'decision') === 'deny' ? 'denied' : 'approved'
      actions.updateExecApproval(resolvedId, { status: newStatus as ExecApprovalRequest['status'] })
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (also used by the tick event handler above)
// ---------------------------------------------------------------------------

export function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export function isSessionActive(timestamp: number): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp < 60 * 60 * 1000
}
