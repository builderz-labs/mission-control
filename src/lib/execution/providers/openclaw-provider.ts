/**
 * OpenClaw Execution Provider
 *
 * Wraps callOpenClawGateway() and runOpenClaw() behind the ExecutionProvider
 * interface. All direct OpenClaw gateway calls in execution paths should go
 * through this provider rather than importing openclaw-gateway or command
 * directly.
 *
 * - spawn/kill/send: migrated (Phase 1+2)
 * - dispatch: migrated (Phase 2) — agent invocation with expect-final
 * - chatSend: migrated (Phase 3) — fire-and-forget message to existing session
 * - sessions POST actions (set-thinking etc.): not execution, remain direct
 */

import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { runOpenClaw } from '@/lib/command'
import type {
  ExecutionProvider,
  ProviderInfo,
  SpawnParams,
  DispatchParams,
  RawDispatchResult,
  ChatSendParams,
  ChatSendResult,
  ProviderResult,
} from './types'

function isToolsSchemaError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase()
  return (
    (msg.includes('unknown field') || msg.includes('unknown key') || msg.includes('invalid argument')) &&
    (msg.includes('tools') || msg.includes('profile'))
  )
}

export class OpenClawProvider implements ExecutionProvider {
  readonly id = 'openclaw'

  async info(): Promise<ProviderResult<ProviderInfo>> {
    return {
      ok: true,
      data: {
        id: this.id,
        capabilities: {
          spawn: true,
          kill: true,
          send: true,
          transcripts: true,
          dispatch: true,
        },
      },
    }
  }

  /**
   * Spawn a new agent session.
   * Handles the tools.profile compatibility fallback for older gateways inline.
   */
  async spawn(params: SpawnParams): Promise<ProviderResult<unknown>> {
    try {
      const data = await callOpenClawGateway('sessions_spawn', params, 15_000)
      return { ok: true, data, meta: { fallbackUsed: false } }
    } catch (firstError: unknown) {
      if (!isToolsSchemaError(firstError)) {
        const message = firstError instanceof Error ? firstError.message : 'Spawn failed'
        return { ok: false, error: { provider: this.id, code: 'SPAWN_FAILED', message, cause: firstError } }
      }
      // Retry without tools field for older gateway versions
      const fallbackParams = { ...params }
      delete (fallbackParams as Record<string, unknown>).tools
      try {
        const data = await callOpenClawGateway('sessions_spawn', fallbackParams, 15_000)
        return { ok: true, data, meta: { fallbackUsed: true } }
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : 'Spawn failed (fallback)'
        return { ok: false, error: { provider: this.id, code: 'SPAWN_FAILED', message, cause } }
      }
    }
  }

  async kill(sessionKey: string): Promise<ProviderResult<unknown>> {
    try {
      const data = await callOpenClawGateway('sessions_kill', { sessionKey }, 10_000)
      return { ok: true, data }
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Kill failed'
      return { ok: false, error: { provider: this.id, code: 'KILL_FAILED', message, cause } }
    }
  }

  async send(sessionKey: string, message: unknown): Promise<ProviderResult<unknown>> {
    try {
      const data = await callOpenClawGateway('sessions_send', { sessionKey, message }, 10_000)
      return { ok: true, data }
    } catch (cause: unknown) {
      const message_ = cause instanceof Error ? cause.message : 'Send failed'
      return { ok: false, error: { provider: this.id, code: 'SEND_FAILED', message: message_, cause } }
    }
  }

  /**
   * Invoke an agent with a message and block until the final response arrives.
   * Uses `gateway call agent --expect-final` which returns the full response payload.
   */
  async dispatch(params: DispatchParams): Promise<ProviderResult<RawDispatchResult>> {
    const {
      agentId,
      message,
      idempotencyKey,
      model,
      deliver = false,
      timeoutMs = 125_000,
    } = params

    const invokeParams: Record<string, unknown> = {
      message,
      agentId,
      idempotencyKey,
      deliver,
    }
    if (model) invokeParams.model = model

    try {
      const result = await runOpenClaw(
        [
          'gateway', 'call', 'agent',
          '--expect-final',
          '--timeout', '120000',
          '--params', JSON.stringify(invokeParams),
          '--json',
        ],
        { timeoutMs },
      )
      return {
        ok: true,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
        },
      }
    } catch (cause: unknown) {
      const message_ = cause instanceof Error ? cause.message : 'Dispatch failed'
      return { ok: false, error: { provider: this.id, code: 'DISPATCH_FAILED', message: message_, cause } }
    }
  }

  /**
   * Send a chat message to an existing active session (chat.send).
   * Fire-and-forget: the session processes the message asynchronously.
   */
  async chatSend(sessionKey: string, params: ChatSendParams): Promise<ProviderResult<ChatSendResult>> {
    const { message, idempotencyKey, deliver = false, timeoutMs = 125_000 } = params
    try {
      const result = await callOpenClawGateway<{ status?: string; runId?: string }>(
        'chat.send',
        { sessionKey, message, idempotencyKey, deliver },
        timeoutMs,
      )
      return {
        ok: true,
        data: {
          status: String(result?.status || 'ok'),
          runId: result?.runId ?? null,
        },
      }
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : 'chat.send failed'
      return { ok: false, error: { provider: this.id, code: 'CHAT_SEND_FAILED', message: msg, cause } }
    }
  }
}
