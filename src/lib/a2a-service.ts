import type { User } from '@/lib/auth'
import { db_helpers, getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { scanForInjection } from '@/lib/injection-guard'
import { logger } from '@/lib/logger'
import { scanForSecrets } from '@/lib/secret-scanner'
import { logSecurityEvent } from '@/lib/security-events'
import {
  type A2AKind,
  type A2AMessage,
  findAgent,
  getA2AMessage,
  insertA2AMessage,
  newThreadId,
  normalizeThreadId,
  recordDelivery,
} from '@/lib/a2a'
import { deliverA2AMessage } from '@/lib/a2a-delivery'

export class A2AError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message)
  }
}

/**
 * Resolves who a message is from. Agent-scoped API keys can only speak as
 * their own agent. Other callers (operators, the global key) may act as an
 * agent via `from` or the X-Agent-Name header; otherwise the human user is the
 * sender.
 */
export function resolveSender(user: User, requestedFrom?: string | null): string {
  const requested = requestedFrom?.trim() || ''
  if (user.agent_id) {
    const own = user.agent_name || user.display_name
    if (requested && requested.toLowerCase() !== own.toLowerCase()) {
      throw new A2AError('Agent-scoped keys can only send as their own agent', 403)
    }
    return own
  }
  return requested || user.agent_name || user.display_name || user.username
}

/**
 * Resolves whose inbox a request may read. Agent-scoped keys are pinned to
 * their own agent; everyone else must name an agent (or send X-Agent-Name).
 */
export function resolveInboxAgent(user: User, requestedAgent?: string | null): string {
  const requested = requestedAgent?.trim() || ''
  if (user.agent_id) {
    const own = user.agent_name || user.display_name
    if (requested && requested.toLowerCase() !== own.toLowerCase()) {
      throw new A2AError('Agent-scoped keys can only access their own inbox', 403)
    }
    return own
  }
  const agent = requested || user.agent_name || ''
  if (!agent) throw new A2AError('"agent" is required (or send the X-Agent-Name header)', 400)
  return agent
}

export interface SendA2AInput {
  to?: string
  content: string
  kind?: A2AKind
  subject?: string | null
  threadId?: string | null
  replyTo?: number | null
  taskId?: number | null
  from?: string | null
}

export async function sendA2AMessage(user: User, input: SendA2AInput): Promise<A2AMessage> {
  const db = getDatabase()
  const workspaceId = user.workspace_id ?? 1
  const from = resolveSender(user, input.from)

  let to = input.to?.trim() || ''
  let threadId: string | null = null
  let subject = input.subject?.trim() || null
  let kind: A2AKind = input.kind ?? 'message'

  if (input.replyTo) {
    const parent = getA2AMessage(db, workspaceId, input.replyTo)
    if (!parent) throw new A2AError('Message to reply to was not found', 404)
    threadId = parent.thread_id
    // Default to answering whoever wrote the parent; if the sender wrote it, answer its recipient.
    if (!to) to = parent.from.toLowerCase() === from.toLowerCase() ? parent.to : parent.from
    subject = subject ?? parent.subject
    if (!input.kind) kind = 'reply'
  } else if (input.threadId) {
    threadId = normalizeThreadId(input.threadId)
    if (!threadId) throw new A2AError('Invalid thread id', 400)
  }

  if (!to) throw new A2AError('"to" is required', 400)
  const recipient = findAgent(db, workspaceId, to)
  if (!recipient) throw new A2AError(`Recipient agent "${to}" not found`, 404)
  if (recipient.name.toLowerCase() === from.toLowerCase()) {
    throw new A2AError('An agent cannot message itself', 400)
  }

  const content = input.content.trim()
  // Content is injected into the recipient agent's prompt.
  const injection = scanForInjection(content, { context: 'prompt' })
  const criticals = injection.safe ? [] : injection.matches.filter((m) => m.severity === 'critical')
  if (criticals.length > 0) {
    logger.warn({ from, to: recipient.name, rules: criticals.map((m) => m.rule) }, 'Blocked A2A message: injection detected')
    throw new A2AError('Message blocked: potentially unsafe content detected', 422, {
      injection: criticals.map((m) => ({ rule: m.rule, description: m.description })),
    })
  }
  const secretHits = scanForSecrets(content)
  if (secretHits.length > 0) {
    try {
      logSecurityEvent({
        event_type: 'secret_exposure',
        severity: 'critical',
        source: 'a2a-message',
        agent_name: from,
        detail: JSON.stringify({ count: secretHits.length, types: secretHits.map((s) => s.type), to: recipient.name }),
        workspace_id: workspaceId,
        tenant_id: user.tenant_id ?? 1,
      })
    } catch { /* best effort */ }
  }

  const message = insertA2AMessage(db, {
    workspaceId,
    from,
    to: recipient.name,
    content,
    kind,
    threadId: threadId ?? newThreadId(),
    subject,
    replyTo: input.replyTo ?? null,
    taskId: input.taskId ?? null,
  })

  db_helpers.logActivity(
    'a2a_message',
    'message',
    message.id,
    from,
    `${from} → ${recipient.name}: ${kind}${subject ? ` "${subject.slice(0, 80)}"` : ''}`,
    { thread_id: message.thread_id, to: recipient.name, kind },
    workspaceId,
  )
  db_helpers.createNotification(
    recipient.name,
    'a2a_message',
    `Message from ${from}`,
    content.slice(0, 200) + (content.length > 200 ? '...' : ''),
    'message',
    message.id,
    workspaceId,
  )

  const delivery = await deliverA2AMessage(message, recipient)
  recordDelivery(db, message.id, delivery)
  const stored = { ...message, delivery }

  eventBus.broadcast('a2a.message', { workspace_id: workspaceId, ...stored })
  return stored
}
