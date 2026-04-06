/**
 * Gateway forwarding utilities for chat message delivery.
 * Extracted here to keep post-handler.ts focused on HTTP concerns only.
 */
import { getDatabase, type Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { eventBus } from '@/lib/event-bus'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { logger } from '@/lib/logger'
import { type ProcessError } from '@/lib/types/sql'
import { safeParseMetadata } from './get-handler'

export const COORDINATOR_AGENT =
  String(
    process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator',
  ).trim() || 'coordinator'

export type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

export type ToolEvent = {
  name: string
  input?: string
  output?: string
  status?: string
}

type ChatAttachmentInput = {
  name?: string
  type?: string
  dataUrl?: string
}

// ---------------------------------------------------------------------------
// JSON / attachment utilities
// ---------------------------------------------------------------------------

export function parseGatewayJson(raw: string): unknown {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

export function toGatewayAttachments(
  value: unknown,
): Array<{ type: 'image'; mimeType: string; fileName?: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap((entry) => {
    const file = entry as ChatAttachmentInput
    if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') return []
    const match = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl)
    if (!match || !match[1].startsWith('image/')) return []
    return [{ type: 'image' as const, mimeType: match[1], fileName: typeof file.name === 'string' ? file.name : undefined, content: match[2] }]
  })
  return attachments.length > 0 ? attachments : undefined
}

// ---------------------------------------------------------------------------
// Tool-event extraction (OpenAI Responses / OpenClaw payload formats)
// ---------------------------------------------------------------------------

function normalizeToolEvent(raw: unknown): ToolEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = String(r.name ?? r.tool ?? r.toolName ?? r.function ?? r.call ?? '').trim()
  if (!name) return null
  const inputRaw = r.input ?? r.args ?? r.arguments ?? r.params
  const outputRaw = r.output ?? r.result ?? r.response
  const statusRaw =
    r.status ??
    (r.isError === true ? 'error' : undefined) ??
    (r.ok === false ? 'error' : undefined) ??
    (r.success === true ? 'ok' : undefined)
  return {
    name,
    input: typeof inputRaw === 'string' ? inputRaw.slice(0, 2000) : inputRaw !== undefined ? JSON.stringify(inputRaw).slice(0, 2000) : undefined,
    output: typeof outputRaw === 'string' ? outputRaw.slice(0, 4000) : outputRaw !== undefined ? JSON.stringify(outputRaw).slice(0, 4000) : undefined,
    status: statusRaw !== undefined ? String(statusRaw).slice(0, 60) : undefined,
  }
}

export function extractReplyText(waitPayload: unknown): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null
  const p = waitPayload as Record<string, unknown>
  for (const key of ['text', 'message', 'response', 'output', 'result']) {
    if (typeof p[key] === 'string' && (p[key] as string).trim()) return (p[key] as string).trim()
  }
  if (typeof p.output === 'object' && p.output && !Array.isArray(p.output)) {
    const o = p.output as Record<string, unknown>
    for (const key of ['text', 'message', 'content']) {
      if (typeof o[key] === 'string' && (o[key] as string).trim()) return (o[key] as string).trim()
    }
  }
  if (Array.isArray(p.output)) {
    const parts: string[] = []
    for (const item of p.output) {
      if (!item || typeof item !== 'object') continue
      const i = item as Record<string, unknown>
      if (typeof i.text === 'string' && (i.text as string).trim()) parts.push((i.text as string).trim())
      if (i.type === 'message' && Array.isArray(i.content)) {
        for (const block of i.content as Record<string, unknown>[]) {
          const bType = String(block.type ?? '')
          if ((bType === 'text' || bType === 'output_text' || bType === 'input_text') && typeof block.text === 'string' && (block.text as string).trim()) {
            parts.push((block.text as string).trim())
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').slice(0, 8000)
  }
  return null
}

export function extractToolEvents(waitPayload: unknown): ToolEvent[] {
  if (!waitPayload || typeof waitPayload !== 'object') return []
  const p = waitPayload as Record<string, unknown>
  const pOutput = p.output as Record<string, unknown> | undefined
  const candidates = [p.toolCalls, p.tools, p.calls, p.events, pOutput?.toolCalls, pOutput?.tools, pOutput?.events]
  const events: ToolEvent[] = []
  for (const list of candidates) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const evt = normalizeToolEvent(item)
      if (evt) events.push(evt)
      if (events.length >= 20) return events
    }
  }
  if (Array.isArray(p.output)) {
    for (const item of p.output) {
      if (!item || typeof item !== 'object') continue
      const i = item as Record<string, unknown>
      const itemType = String(i.type ?? '').toLowerCase()
      if (itemType === 'function_call' || itemType === 'tool_call') {
        const evt = normalizeToolEvent({ name: i.name ?? i.tool_name ?? i.toolName, arguments: i.arguments ?? i.input, output: i.output ?? i.result, status: i.status })
        if (evt) events.push(evt)
      } else if (itemType === 'message' && Array.isArray(i.content)) {
        for (const block of i.content as Record<string, unknown>[]) {
          const blockType = String(block?.type ?? '').toLowerCase()
          if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'function_call') {
            const evt = normalizeToolEvent(block)
            if (evt) events.push(evt)
          }
        }
      }
      if (events.length >= 20) return events
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// DB write helper: insert a system reply and broadcast to SSE clients
// ---------------------------------------------------------------------------

export function createChatReply(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' | 'tool_call' = 'status',
  metadata: Record<string, unknown> | null = null,
): void {
  const replyInsert = db
    .prepare(
      `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(conversationId, fromAgent, toAgent, content, messageType, metadata ? JSON.stringify(metadata) : null, workspaceId)

  const row = db
    .prepare(
      'SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at, workspace_id FROM messages WHERE id = ? AND workspace_id = ?',
    )
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', { ...row, metadata: safeParseMetadata(row.metadata) })
}

// ---------------------------------------------------------------------------
// Wait for coordinator run completion and post feedback messages
// ---------------------------------------------------------------------------

export async function handleCoordinatorWait(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  from: string,
  runId: string,
): Promise<void> {
  try {
    const waitResult = await runOpenClaw(
      ['gateway', 'call', 'agent.wait', '--timeout', '8000', '--params', JSON.stringify({ runId, timeoutMs: 6000 }), '--json'],
      { timeoutMs: 9000 },
    )
    const waitPayload = parseGatewayJson(waitResult.stdout)
    const waitStatus = String((waitPayload as Record<string, unknown>)?.status ?? '').toLowerCase()
    const toolEvents = extractToolEvents(waitPayload)

    for (const evt of toolEvents) {
      createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, evt.name, 'tool_call', {
        event: 'tool_call', toolName: evt.name, input: evt.input ?? null, output: evt.output ?? null, status: evt.status ?? null, runId,
      })
    }

    if (waitStatus === 'error') {
      const reason = typeof (waitPayload as Record<string, unknown>)?.error === 'string'
        ? (waitPayload as Record<string, unknown>).error
        : 'Unknown runtime error'
      createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, `I received your message, but execution failed: ${reason}`, 'status', { status: 'error', runId })
    } else if (waitStatus === 'timeout') {
      createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, 'I received your message and I am still processing it. I will post results as soon as execution completes.', 'status', { status: 'processing', runId })
    } else {
      const replyText = extractReplyText(waitPayload)
      createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, replyText || 'Execution accepted and completed. No textual response payload was returned by the runtime.', replyText ? 'text' : 'status', { status: waitStatus || 'completed', runId })
    }
  } catch (waitErr) {
    const maybeWaitStdout = String((waitErr as ProcessError)?.stdout || '')
    const maybeWaitStderr = String((waitErr as ProcessError)?.stderr || '')
    const waitPayload = parseGatewayJson(maybeWaitStdout)
    const reason = typeof (waitPayload as Record<string, unknown>)?.error === 'string'
      ? (waitPayload as Record<string, unknown>).error
      : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()
    createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, `I received your message, but I could not retrieve completion output yet: ${reason}`, 'status', { status: 'unknown', runId })
  }
}

// ---------------------------------------------------------------------------
// Resolve and execute gateway forwarding for a given message
// ---------------------------------------------------------------------------

export interface ForwardMessageParams {
  db: ReturnType<typeof getDatabase>
  workspaceId: number
  messageId: number
  from: string
  to: string
  content: string
  conversationId: string
  sessionKey: string | null
  openclawAgentId: string | null
  attachments: unknown
}

/**
 * Attempt to deliver a chat message to the target agent via OpenClaw gateway.
 * Returns a ForwardInfo describing the outcome.
 */
export async function forwardMessageToGateway(params: ForwardMessageParams): Promise<ForwardInfo> {
  const { db, workspaceId, messageId, from, to, content, conversationId, attachments } = params
  let { sessionKey, openclawAgentId } = params
  const forwardInfo: ForwardInfo = { attempted: true, delivered: false }

  if (!sessionKey && !openclawAgentId) {
    forwardInfo.reason = 'no_active_session'
    // Emit visible offline status for coordinator threads
    if (conversationId.startsWith('coord:')) {
      try {
        createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, 'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.', 'status', { status: 'offline', reason: 'no_active_session' })
      } catch (e) {
        logger.error({ err: e }, 'Failed to create offline status reply')
      }
    }
    return forwardInfo
  }

  const idempotencyKey = `mc-${messageId}-${Date.now()}`
  try {
    if (sessionKey) {
      const acceptedPayload = await callOpenClawGateway<Record<string, unknown>>(
        'chat.send',
        { sessionKey, message: content, idempotencyKey, deliver: false, attachments: toGatewayAttachments(attachments) },
        12000,
      )
      const status = String(acceptedPayload?.status ?? '').toLowerCase()
      forwardInfo.delivered = status === 'started' || status === 'ok' || status === 'in_flight'
      forwardInfo.session = sessionKey
      if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) forwardInfo.runId = acceptedPayload.runId
    } else {
      const invokeResult = await runOpenClaw(
        ['gateway', 'call', 'agent', '--timeout', '10000', '--params', JSON.stringify({ message: `Message from ${from}: ${content}`, idempotencyKey, deliver: false, agentId: openclawAgentId }), '--json'],
        { timeoutMs: 12000 },
      )
      const acceptedPayload = parseGatewayJson(invokeResult.stdout) as Record<string, unknown> | null
      forwardInfo.delivered = true
      forwardInfo.session = openclawAgentId ?? undefined
      if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) forwardInfo.runId = acceptedPayload.runId
    }
  } catch (err) {
    // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
    // Treat accepted runs as successful delivery.
    const maybeStdout = String((err as ProcessError)?.stdout || '')
    const acceptedPayload = parseGatewayJson(maybeStdout) as Record<string, unknown> | null
    if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
      forwardInfo.delivered = true
      forwardInfo.session = sessionKey ?? openclawAgentId ?? undefined
      if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) forwardInfo.runId = acceptedPayload.runId
    } else {
      forwardInfo.reason = 'gateway_send_failed'
      logger.error({ err }, 'Failed to forward message via gateway')
      if (conversationId.startsWith('coord:')) {
        try {
          createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, 'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.', 'status', { status: 'delivery_failed', reason: 'gateway_send_failed' })
        } catch (e) {
          logger.error({ err: e }, 'Failed to create gateway failure status reply')
        }
      }
    }
  }

  // Show visible coordinator acknowledgement in coord: threads on success
  if (conversationId.startsWith('coord:') && forwardInfo.delivered) {
    try {
      createChatReply(db, workspaceId, conversationId, COORDINATOR_AGENT, from, 'Received. I am coordinating downstream agents now.', 'status', { status: 'accepted', runId: forwardInfo.runId ?? null })
    } catch (e) {
      logger.error({ err: e }, 'Failed to create accepted status reply')
    }
    if (forwardInfo.runId) {
      await handleCoordinatorWait(db, workspaceId, conversationId, from, forwardInfo.runId)
    }
  }

  return forwardInfo
}
