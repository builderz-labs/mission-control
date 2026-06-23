import { config } from '@/lib/config'

/**
 * Dispatch a board task to the Atlas control plane — a REAL Claude Code session
 * in the agent's repo (tools, file edits, deploys), as opposed to the toothless
 * "direct Claude API" persona-completion path. Fire-and-forget: Atlas PATCHes
 * /api/tasks/[id]/dispatch back with the outcome (→ review / failed).
 *
 * Shared by the task-board ▶ Dispatch button's route and the scheduler's
 * board-driven auto-dispatch (MC_AUTODISPATCH_MODE=atlas).
 */
export interface AtlasDispatchResult {
  accepted: boolean
  dispatchId?: string | number
  status?: string
  error?: string
}

export async function dispatchTaskViaAtlas(args: {
  taskId: number
  agent: string
  prompt: string
  requestedBy?: string
}): Promise<AtlasDispatchResult> {
  if (!config.atlas.dispatchUrl || !config.atlas.dispatchKey) {
    return { accepted: false, error: 'atlas_not_configured' }
  }

  const base = config.atlas.dispatchUrl.replace(/\/$/, '')
  const mcBase = (process.env.MC_PUBLIC_URL || '').replace(/\/$/, '')
  // If MC_PUBLIC_URL is unset, omit callback_url — Atlas derives it from its own
  // MC_BASE_URL + mc_task_id, so completion still flows back.
  const callbackUrl = mcBase ? `${mcBase}/api/tasks/${args.taskId}/dispatch` : undefined

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
        prompt: args.prompt,
        mc_task_id: String(args.taskId),
        callback_url: callbackUrl,
        requested_by: args.requestedBy || 'scheduler-autodispatch',
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    // Infra failure (Atlas unreachable/timeout) — caller must NOT eat the task.
    return { accepted: false, error: `unreachable:${String(err)}` }
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    return {
      accepted: false,
      status: String(res.status),
      error: (typeof data.error === 'string' && data.error) || `atlas_${res.status}`,
    }
  }
  return {
    accepted: true,
    dispatchId: (data.dispatch_id as string | number | undefined) ?? (data.id as string | number | undefined),
    status: String(data.status || ''),
  }
}
