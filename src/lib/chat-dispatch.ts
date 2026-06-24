import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

/**
 * Chat → Atlas control-plane bridge.
 *
 * Replaces the removed OpenClaw gateway as the chat delivery path. A chat
 * message is forwarded to Atlas's HTTP dispatch intake (the same engine the
 * task-board "Dispatch" button uses). Atlas runs a Claude Code session in the
 * target agent's repo and posts the result back to MC asynchronously.
 *
 * The conversation + agent are carried in the callback URL's query string, so
 * Atlas stays chat-agnostic — it just PATCHes back whatever URL we hand it.
 */

export interface ChatDispatchResult {
  accepted: boolean
  autoRunning: boolean
  dispatchId?: string | number
  reason?: string
}

export async function dispatchChatToAgent(args: {
  agent: string
  prompt: string
  conversationId: string
  fromUser: string
  originMessageId: number
  requestedBy: string
  mcBase: string
}): Promise<ChatDispatchResult> {
  if (!config.atlas.dispatchUrl || !config.atlas.dispatchKey) {
    return { accepted: false, autoRunning: false, reason: 'dispatch_not_configured' }
  }

  const base = config.atlas.dispatchUrl.replace(/\/$/, '')
  const mcBase = args.mcBase.replace(/\/$/, '')
  const params = new URLSearchParams({
    conv: args.conversationId,
    agent: args.agent.toLowerCase(),
    msg: String(args.originMessageId),
  })
  const callbackUrl = `${mcBase}/api/chat/dispatch-callback?${params.toString()}`

  // Frame the prompt so the agent answers conversationally — its final message
  // is what the callback surfaces verbatim as the chat reply.
  const prompt = [
    `You are replying inside a Mission Control chat thread with ${args.fromUser}.`,
    `Answer their message directly and concisely. If it needs work in your repo,`,
    `do it and report what you did. Your final message is shown verbatim as the`,
    `chat reply, so make it a clean answer, not a log.`,
    ``,
    `Message: ${args.prompt}`,
  ].join('\n')

  let res: Response
  try {
    res = await fetch(`${base}/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dispatch-Key': config.atlas.dispatchKey,
      },
      body: JSON.stringify({
        agent: args.agent.toLowerCase(),
        prompt,
        callback_url: callbackUrl,
        requested_by: args.requestedBy,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    logger.error({ err: String(err), agent: args.agent }, 'chat dispatch: Atlas unreachable')
    return { accepted: false, autoRunning: false, reason: 'dispatch_unreachable' }
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    logger.warn({ status: res.status, data }, 'chat dispatch: Atlas rejected')
    return {
      accepted: false,
      autoRunning: false,
      reason: (typeof data.error === 'string' && data.error) || `atlas_${res.status}`,
    }
  }

  const status = String(data.status || '').toLowerCase()
  return {
    accepted: true,
    autoRunning: status === 'running',
    dispatchId: (data.dispatch_id as string | number | undefined) ?? (data.id as string | number | undefined),
    reason: typeof data.message === 'string' ? data.message : undefined,
  }
}
