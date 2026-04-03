'use client'

// ---------------------------------------------------------------------------
// WebSocket — gateway message and broadcast event dispatch
// ---------------------------------------------------------------------------
import { type GatewayFrame, type GatewayMessage } from './websocket-types'
import { normalizeModel } from '@/lib/utils'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('WebSocket')

// ---------------------------------------------------------------------------
// Action interfaces (subset of useMissionControl store actions)
// ---------------------------------------------------------------------------

export interface GatewayMessageActions {
  setLastMessage: (msg: GatewayMessage) => void
  setSessions: (sessions: any[]) => void
  addLog: (entry: any) => void
  updateSpawnRequest: (id: any, data: any) => void
  setCronJobs: (jobs: any[]) => void
  addTokenUsage: (usage: any) => void
}

export interface BroadcastEventActions {
  setSessions: (sessions: any[]) => void
  addLog: (entry: any) => void
  addChatMessage: (msg: any) => void
  addNotification: (notif: any) => void
  updateAgent: (id: any, data: any) => void
  addExecApproval: (approval: any) => void
  updateExecApproval: (id: any, data: any) => void
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

  switch (message.type) {
    case 'session_update':
      if (message.data?.sessions) {
        actions.setSessions(message.data.sessions.map((session: any, index: number) => ({
          id: session.key || `session-${index}`,
          key: session.key || '',
          kind: session.kind || 'unknown',
          age: session.age || '',
          model: normalizeModel(session.model),
          tokens: session.tokens || '',
          flags: session.flags || [],
          active: session.active || false,
          startTime: session.startTime,
          lastActivity: session.lastActivity,
          messageCount: session.messageCount,
          cost: session.cost,
        })))
      }
      break

    case 'log':
      if (message.data) {
        actions.addLog({
          id: message.data.id || `log-${Date.now()}-${Math.random()}`,
          timestamp: message.data.timestamp || message.timestamp || Date.now(),
          level: message.data.level || 'info',
          source: message.data.source || 'gateway',
          session: message.data.session,
          message: message.data.message || '',
          data: message.data.extra || message.data.data,
        })
      }
      break

    case 'spawn_result':
      if (message.data?.id) {
        actions.updateSpawnRequest(message.data.id, {
          status: message.data.status,
          completedAt: message.data.completedAt,
          result: message.data.result,
          error: message.data.error,
        })
      }
      break

    case 'cron_status':
      if (message.data?.jobs) {
        actions.setCronJobs(message.data.jobs)
      }
      break

    case 'event':
      if (message.data?.type === 'token_usage') {
        actions.addTokenUsage({
          model: normalizeModel(message.data.model),
          sessionId: message.data.sessionId,
          date: new Date().toISOString(),
          inputTokens: message.data.inputTokens || 0,
          outputTokens: message.data.outputTokens || 0,
          totalTokens: message.data.totalTokens || 0,
          cost: message.data.cost || 0,
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

  if (frame.event === 'tick') {
    const snapshot = frame.payload?.snapshot
    if (snapshot?.sessions) {
      actions.setSessions(snapshot.sessions.map((session: any, index: number) => ({
        id: session.key || `session-${index}`,
        key: session.key || '',
        kind: session.kind || 'unknown',
        age: formatAge(session.updatedAt),
        model: normalizeModel(session.model),
        tokens: `${session.totalTokens || 0}/${session.contextTokens || 35000}`,
        flags: [],
        active: isSessionActive(session.updatedAt),
        startTime: session.updatedAt,
        lastActivity: session.updatedAt,
        messageCount: session.messageCount,
        cost: session.cost,
      })))
    }
  } else if (frame.event === 'log') {
    const logData = frame.payload
    if (logData) {
      actions.addLog({
        id: logData.id || `log-${Date.now()}-${Math.random()}`,
        timestamp: logData.timestamp || Date.now(),
        level: logData.level || 'info',
        source: logData.source || 'gateway',
        session: logData.session,
        message: logData.message || '',
        data: logData.extra || logData.data,
      })
    }
  } else if (frame.event === 'chat.message') {
    const msg = frame.payload
    if (msg) {
      actions.addChatMessage({
        id: msg.id,
        conversation_id: msg.conversation_id,
        from_agent: msg.from_agent,
        to_agent: msg.to_agent,
        content: msg.content,
        message_type: msg.message_type || 'text',
        metadata: msg.metadata,
        read_at: msg.read_at,
        created_at: msg.created_at || Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'notification') {
    const notif = frame.payload
    if (notif) {
      actions.addNotification({
        id: notif.id,
        recipient: notif.recipient || 'operator',
        type: notif.type || 'info',
        title: notif.title || '',
        message: notif.message || '',
        source_type: notif.source_type,
        source_id: notif.source_id,
        created_at: notif.created_at || Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'agent.status') {
    const data = frame.payload
    if (data?.id) {
      actions.updateAgent(data.id, {
        status: data.status,
        last_seen: data.last_seen,
        last_activity: data.last_activity,
      })
    }
  } else if (frame.event === 'tool.stream') {
    const t = frame.payload
    if (t) {
      actions.addChatMessage({
        id: t.id || -(Date.now() + Math.random()),
        conversation_id: t.conversation_id || t.sessionId || 'tool-stream',
        from_agent: t.agentName || t.agent || 'agent',
        to_agent: null,
        content: '',
        message_type: 'tool_call',
        metadata: {
          toolName: t.toolName || t.name,
          toolArgs: t.args || t.toolArgs,
          toolOutput: t.output || t.toolOutput,
          toolStatus: t.status || 'success',
          durationMs: t.durationMs,
        },
        created_at: t.timestamp ? Math.floor(t.timestamp / 1000) : Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'context.compaction') {
    actions.addNotification({
      id: Date.now(),
      recipient: 'operator',
      type: 'info',
      title: 'Context Compaction',
      message: frame.payload?.message || `Session context compacted (${frame.payload?.percentage || '?'}% reduced)`,
      created_at: Math.floor(Date.now() / 1000),
    })
  } else if (frame.event === 'model.fallback') {
    actions.addNotification({
      id: Date.now(),
      recipient: 'operator',
      type: 'warning',
      title: 'Model Fallback',
      message: frame.payload?.message || `Fell back from ${frame.payload?.from || '?'} to ${frame.payload?.to || '?'}`,
      created_at: Math.floor(Date.now() / 1000),
    })
  } else if (frame.event === 'exec.approval' || frame.event === 'exec.approval.requested') {
    // Supports both event name variants
    const a = frame.payload
    const request = a?.request || a
    if (a?.id) {
      actions.addExecApproval({
        id: a.id,
        sessionId: request?.sessionKey || a.sessionId || '',
        agentName: request?.agentId || a.agentName,
        toolName: a.toolName || a.name || request?.command || 'unknown',
        toolArgs: a.args || a.toolArgs || {},
        command: request?.command || a.command,
        cwd: request?.cwd || a.cwd,
        host: request?.host || a.host,
        resolvedPath: request?.resolvedPath || a.resolvedPath,
        risk: a.risk || 'medium',
        createdAt: a.createdAtMs || a.createdAt || Date.now(),
        expiresAt: a.expiresAtMs || a.expiresAt,
        status: 'pending',
      })
      actions.addNotification({
        id: Date.now(),
        recipient: 'operator',
        type: 'warning',
        title: 'Exec Approval Required',
        message: `${request?.agentId || a.agentName || 'Agent'} wants to run: ${request?.command || a.toolName || a.name || 'tool'}`,
        created_at: Math.floor(Date.now() / 1000),
      })
    }
  } else if (frame.event === 'exec.approval.resolved') {
    const resolved = frame.payload
    if (resolved?.id) {
      const newStatus = resolved.decision === 'deny' ? 'denied' : 'approved'
      actions.updateExecApproval(resolved.id, { status: newStatus as any })
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
