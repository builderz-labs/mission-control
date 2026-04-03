// ---------------------------------------------------------------------------
// Task Dispatch — model routing and gateway agent ID resolution
// ---------------------------------------------------------------------------
import { type DispatchableTask, type ReviewableTask } from './task-dispatch-types'

/**
 * Classify a task's complexity and return the appropriate model ID to pass
 * to the OpenClaw gateway. Uses keyword signals on title + description.
 *
 * Tiers:
 *   ROUTINE  → cheap model (Haiku)   — file ops, status checks, formatting
 *   MODERATE → mid model  (Sonnet)   — code gen, summaries, analysis, drafts
 *   COMPLEX  → premium model (Opus)  — debugging, architecture, novel problems
 *
 * The caller may override this by setting agent.config.dispatchModel.
 */
export function classifyTaskModel(task: DispatchableTask): string | null {
  // Allow per-agent config override
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) return cfg.dispatchModel
    } catch { /* ignore */ }
  }

  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  const priority = task.priority?.toLowerCase() ?? ''

  // Complex signals → Opus
  const complexSignals = [
    'debug', 'diagnos', 'architect', 'design system', 'security audit',
    'root cause', 'investigate', 'incident', 'failure', 'broken', 'not working',
    'refactor', 'migration', 'performance optim', 'why is',
  ]
  if (priority === 'critical' || complexSignals.some(s => text.includes(s))) {
    return '9router/cc/claude-opus-4-6'
  }

  // Routine signals → Haiku
  const routineSignals = [
    'status check', 'health check', 'ping', 'list ', 'fetch ', 'format',
    'rename', 'move file', 'read file', 'update readme', 'bump version',
    'send message', 'post to', 'notify', 'summarize', 'translate',
    'quick ', 'simple ', 'routine ', 'minor ',
  ]
  if (priority === 'low' && routineSignals.some(s => text.includes(s))) {
    return '9router/cc/claude-haiku-4-5-20251001'
  }
  if (routineSignals.some(s => text.includes(s)) && priority !== 'high' && priority !== 'critical') {
    return '9router/cc/claude-haiku-4-5-20251001'
  }

  // Default: let the agent's own configured model handle it (no override)
  return null
}

/** Extract the gateway agent identifier from the agent's config JSON.
 *  Falls back to agent_name (display name) if openclawId is not set. */
export function resolveGatewayAgentId(task: DispatchableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.agent_name
}

export function resolveGatewayAgentIdForReview(task: ReviewableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.assigned_to || 'jarv'
}
