import { createHmac } from 'node:crypto'
import { runOpenClaw } from '@/lib/command'
import { logger } from '@/lib/logger'
import type { A2AAgentRow, A2ADelivery, A2AMessage } from '@/lib/a2a'

/**
 * Push delivery for A2A messages. Every message is always stored in the
 * recipient's inbox; delivery additionally wakes the recipient's runtime when
 * one is reachable:
 *
 *   - Hermes: signed POST to a Hermes webhook route (MC_HERMES_A2A_WEBHOOK_URL
 *     + MC_HERMES_A2A_WEBHOOK_SECRET), using Hermes' "Generic V2" HMAC scheme.
 *   - OpenClaw: `openclaw gateway sessions_send` when the agent has a session key.
 *   - Otherwise inbox only; the agent picks it up via mc_inbox.
 */

const DELIVERY_TIMEOUT_MS = 5_000

type EnvLike = Record<string, string | undefined>

export interface HermesWebhookConfig {
  url: string
  secret: string
}

export function getHermesWebhookConfig(env: EnvLike = process.env): HermesWebhookConfig | null {
  const url = (env.MC_HERMES_A2A_WEBHOOK_URL || '').trim()
  const secret = (env.MC_HERMES_A2A_WEBHOOK_SECRET || '').trim()
  if (!url || !secret) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  } catch {
    return null
  }
  return { url, secret }
}

export function isHermesAgent(agent: A2AAgentRow): boolean {
  return agent.runtime_type === 'hermes' || agent.name.toLowerCase() === 'hermes'
}

/** Hermes webhook "Generic V2": hex HMAC-SHA256 over `<timestamp>.<body>`. */
export function signHermesWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Text injected into a live session; tells the recipient how to answer. */
export function formatDeliveryText(message: A2AMessage): string {
  const header = message.subject
    ? `[A2A ${message.kind}] From ${message.from} — "${message.subject}"`
    : `[A2A ${message.kind}] From ${message.from}`
  return [
    header,
    '',
    message.content,
    '',
    `(thread ${message.thread_id}, message #${message.id}. Reply with the mc_reply tool: message_id=${message.id})`,
  ].join('\n')
}

export function buildHermesPayload(message: A2AMessage) {
  return {
    event: 'a2a.message',
    message_id: message.id,
    thread_id: message.thread_id,
    from: message.from,
    to: message.to,
    kind: message.kind,
    subject: message.subject ?? '',
    content: message.content,
    task_id: message.task_id,
    text: formatDeliveryText(message),
  }
}

async function deliverToHermes(message: A2AMessage, config: HermesWebhookConfig): Promise<A2ADelivery> {
  const body = JSON.stringify(buildHermesPayload(message))
  const timestamp = Math.floor(Date.now() / 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature-V2': signHermesWebhook(config.secret, timestamp, body),
      },
      body,
      signal: controller.signal,
    })
    if (!res.ok) {
      return { mode: 'hermes', delivered: false, reason: `webhook_http_${res.status}`, at: nowSeconds() }
    }
    return { mode: 'hermes', delivered: true, at: nowSeconds() }
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'webhook_timeout' : 'webhook_unreachable'
    logger.warn({ err, messageId: message.id }, 'A2A Hermes webhook delivery failed')
    return { mode: 'hermes', delivered: false, reason, at: nowSeconds() }
  } finally {
    clearTimeout(timer)
  }
}

async function deliverToOpenClaw(message: A2AMessage, sessionKey: string): Promise<A2ADelivery> {
  try {
    await runOpenClaw(
      ['gateway', 'sessions_send', '--session', sessionKey, '--message', formatDeliveryText(message)],
      { timeoutMs: DELIVERY_TIMEOUT_MS * 2 },
    )
    return { mode: 'openclaw', delivered: true, at: nowSeconds() }
  } catch (err) {
    logger.warn({ err, messageId: message.id }, 'A2A OpenClaw session delivery failed')
    return { mode: 'openclaw', delivered: false, reason: 'sessions_send_failed', at: nowSeconds() }
  }
}

export async function deliverA2AMessage(
  message: A2AMessage,
  recipient: A2AAgentRow,
  env: EnvLike = process.env,
): Promise<A2ADelivery> {
  if (isHermesAgent(recipient)) {
    const config = getHermesWebhookConfig(env)
    if (config) return deliverToHermes(message, config)
    return { mode: 'inbox', delivered: false, reason: 'hermes_webhook_not_configured', at: nowSeconds() }
  }
  if (recipient.session_key) {
    return deliverToOpenClaw(message, recipient.session_key)
  }
  return { mode: 'inbox', delivered: false, reason: 'no_push_channel', at: nowSeconds() }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
