import { getDatabase, db_helpers } from './db'
import { runOpenClaw } from './command'
import { callOpenClawGateway } from './openclaw-gateway'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { config } from './config'
import { syncTaskOutbound } from './github-sync-engine'
import {
  buildFailureSignature,
  decideBudgetRoute,
  deriveFallbackModel,
  parseTaskMetadata,
  serializeTaskMetadata,
} from './task-harness'

/** Sync task to GitHub/GNAP and broadcast escalation if task failed */
function syncAndEscalateIfFailed(task: { id: number; title: string; status: string; priority: string; project_id?: number | null; workspace_id: number; description?: string | null }, newStatus: string, errorMsg?: string, dispatchAttempts?: number): void {
  syncTaskOutbound({ ...task, status: newStatus }, task.workspace_id)
  if (newStatus === 'failed') {
    eventBus.broadcast('task.escalated', {
      id: task.id,
      title: task.title,
      reason: errorMsg?.includes('Aegis rejected') ? 'max_aegis_rejections' : errorMsg?.includes('stuck') ? 'stale_task_max_retries' : 'max_dispatch_retries',
      dispatch_attempts: dispatchAttempts ?? 0,
      error_message: (errorMsg ?? '').substring(0, 500),
      workspace_id: task.workspace_id,
    })
  }
}

interface DispatchableTask {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string
  workspace_id: number
  agent_name: string
  agent_id: number
  agent_config: string | null
  ticket_prefix: string | null
  project_ticket_no: number | null
  project_id: number | null
  tags?: string[]
  metadata?: string | null
}

interface PreflightResult {
  ok: boolean
  status?: string
  reason?: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------

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
function classifyTaskModel(task: DispatchableTask): string | null {
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

  // Size heuristics → Opus for large/complex tasks
  const descLength = (task.description ?? '').length
  if (descLength > 2000) return '9router/cc/claude-opus-4-6'
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT estimated_hours FROM tasks WHERE id = ?').get(task.id) as { estimated_hours: number | null } | undefined
    if (row?.estimated_hours && row.estimated_hours >= 4) return '9router/cc/claude-opus-4-6'
  } catch { /* ignore */ }

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

function runTaskPreflight(task: DispatchableTask): PreflightResult {
  const metadata = parseTaskMetadata(task.metadata)
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  let blockedStatus: string | undefined
  let reason: string | undefined

  if (metadata.implementation_repo) {
    const repo = String(metadata.implementation_repo).trim()
    const looksResolvable = repo.startsWith('/') || repo.includes('/')
    const ok = looksResolvable
    checks.push({ name: 'implementation_repo', ok, detail: repo })
    if (!ok) {
      blockedStatus = 'blocked_env'
      reason = `implementation_repo is not actionable: ${repo}`
    }
  }

  if (metadata.code_location) {
    const codeLocation = String(metadata.code_location).trim()
    const ok = codeLocation.startsWith('/')
    checks.push({ name: 'code_location', ok, detail: codeLocation })
    if (!ok && !blockedStatus) {
      blockedStatus = 'blocked_env'
      reason = `code_location must be absolute: ${codeLocation}`
    }
  }

  const checkedAt = Math.floor(Date.now() / 1000)
  return {
    ok: !blockedStatus,
    status: blockedStatus,
    reason,
    metadata: {
      ...metadata,
      harness: {
        ...(metadata.harness || {}),
        step: blockedStatus ? 'preflight-blocked' : 'ready',
        preflight: {
          checked_at: checkedAt,
          ok: !blockedStatus,
          checks,
        },
      },
    },
  }
}

/** Extract the gateway agent identifier from the agent's config JSON.
 *  Falls back to agent_name (display name) if openclawId is not set. */
function resolveGatewayAgentId(task: DispatchableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.agent_name
}

function buildTaskPrompt(task: DispatchableTask, rejectionFeedback?: string | null): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You have been assigned a task in Mission Control.',
    '',
    `**[${ticket}] ${task.title}**`,
    `Priority: ${task.priority}`,
  ]

  if (task.tags && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(', ')}`)
  }

  if (task.description) {
    lines.push('', task.description)
  }

  if (rejectionFeedback) {
    lines.push('', '## Previous Review Feedback', rejectionFeedback, '', 'Please address this feedback in your response.')
  }

  lines.push('', 'Complete this task and provide your response. Be concise and actionable.')
  return lines.join('\n')
}

/** Extract first valid JSON object from raw stdout (handles surrounding text/warnings). */
function parseGatewayJson(raw: string): any | null {
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

interface AgentResponseParsed {
  text: string | null
  sessionId: string | null
}

interface GatewayCallResult {
  response: AgentResponseParsed
  modelFallbackUsed: boolean
  attemptedModel: string | null
}

function toErrorText(err: unknown): string {
  return `${err instanceof Error ? err.message : String(err ?? '')}\n${(err as { stdout?: string }).stdout || ''}\n${(err as { stderr?: string }).stderr || ''}`.trim()
}

function isModelOverridePolicyError(err: unknown): boolean {
  const text = toErrorText(err).toLowerCase()
  return text.includes('model override') && text.includes('not allowed') && text.includes('for agent')
}

function buildGatewayAgentParams(prompt: string, agentId: string, idempotencyKey: string, modelOverride: string | null): Record<string, unknown> {
  const params: Record<string, unknown> = {
    message: prompt,
    agentId,
    idempotencyKey,
    deliver: false,
  }
  if (modelOverride) params.model = modelOverride
  return params
}

async function runGatewayAgent(
  task: DispatchableTask,
  prompt: string,
  modelOverride: string | null,
): Promise<GatewayCallResult> {
  const baseId = `task-${task.id}`
  const params = buildGatewayAgentParams(prompt, resolveGatewayAgentId(task), `${baseId}-${Date.now()}`, modelOverride)

  try {
    const finalResult = await runOpenClaw(
      ['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000', '--params', JSON.stringify(params), '--json'],
      { timeoutMs: 125_000 }
    )
    const finalPayload = parseGatewayJson(finalResult.stdout)
      ?? parseGatewayJson(String((finalResult as any)?.stderr || ''))

    return {
      response: parseAgentResponse(
        finalPayload?.result ? JSON.stringify(finalPayload.result) : finalResult.stdout
      ),
      modelFallbackUsed: false,
      attemptedModel: modelOverride,
    }
  } catch (err: any) {
    if (modelOverride && isModelOverridePolicyError(err)) {
      logger.warn(
        {
          taskId: task.id,
          agent: task.agent_name,
          attemptedModel: modelOverride,
          error: toErrorText(err).substring(0, 300),
        },
        'Gateway rejected model override, retrying task with agent default model'
      )
      const fallbackParams = buildGatewayAgentParams(prompt, resolveGatewayAgentId(task), `${baseId}-fallback-${Date.now()}`, null)
      const fallbackResult = await runOpenClaw(
        ['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000', '--params', JSON.stringify(fallbackParams), '--json'],
        { timeoutMs: 125_000 }
      )
      const fallbackPayload = parseGatewayJson(fallbackResult.stdout)
        ?? parseGatewayJson(String((fallbackResult as any)?.stderr || ''))

      return {
        response: parseAgentResponse(
          fallbackPayload?.result ? JSON.stringify(fallbackPayload.result) : fallbackResult.stdout
        ),
        modelFallbackUsed: true,
        attemptedModel: modelOverride,
      }
    }
    throw err
  }
}

function parseAgentResponse(stdout: string): AgentResponseParsed {
  try {
    const parsed = JSON.parse(stdout)
    const sessionId: string | null = typeof parsed?.sessionId === 'string' ? parsed.sessionId
      : typeof parsed?.session_id === 'string' ? parsed.session_id
      : null

    // OpenClaw agent --json returns { payloads: [{ text: "..." }] }
    if (parsed?.payloads?.[0]?.text) {
      return { text: parsed.payloads[0].text, sessionId }
    }
    // Fallback: if there's a result or output field
    if (parsed?.result) return { text: String(parsed.result), sessionId }
    if (parsed?.output) return { text: String(parsed.output), sessionId }
    // Last resort: stringify the whole response
    return { text: JSON.stringify(parsed, null, 2), sessionId }
  } catch {
    // Not valid JSON — return raw stdout if non-empty
    return { text: stdout.trim() || null, sessionId: null }
  }
}

// ---------------------------------------------------------------------------
// Direct Claude API dispatch (gateway-free)
// ---------------------------------------------------------------------------

function getAnthropicApiKey(): string | null {
  return (process.env.ANTHROPIC_API_KEY || '').trim() || null
}

function isGatewayAvailable(): boolean {
  // Gateway is available if OpenClaw is installed OR a gateway is registered in the DB
  if (config.openclawHome) return true
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT COUNT(*) as c FROM gateways').get() as { c: number } | undefined
    return (row?.c ?? 0) > 0
  } catch {
    return false
  }
}

function classifyDirectModel(task: DispatchableTask): string {
  // Check per-agent config override first
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) {
        // Strip gateway prefixes like "9router/cc/" to get bare model ID
        return cfg.dispatchModel.replace(/^.*\//, '')
      }
    } catch { /* ignore */ }
  }

  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  const priority = task.priority?.toLowerCase() ?? ''

  // Complex → Opus
  const complexSignals = [
    'debug', 'diagnos', 'architect', 'design system', 'security audit',
    'root cause', 'investigate', 'incident', 'refactor', 'migration',
  ]
  if (priority === 'critical' || complexSignals.some(s => text.includes(s))) {
    return 'claude-opus-4-6'
  }

  // Size heuristics → Opus for large/complex tasks
  const descLength = (task.description ?? '').length
  if (descLength > 2000) return 'claude-opus-4-6'
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT estimated_hours FROM tasks WHERE id = ?').get(task.id) as { estimated_hours: number | null } | undefined
    if (row?.estimated_hours && row.estimated_hours >= 4) return 'claude-opus-4-6'
  } catch { /* ignore */ }

  // Routine → Haiku
  const routineSignals = [
    'status check', 'health check', 'format', 'rename', 'summarize',
    'translate', 'quick ', 'simple ', 'routine ', 'minor ',
  ]
  if (routineSignals.some(s => text.includes(s)) && priority !== 'high' && priority !== 'critical') {
    return 'claude-haiku-4-5-20251001'
  }

  // Default → Sonnet
  return 'claude-sonnet-4-6'
}

function getAgentSoulContent(task: DispatchableTask): string | null {
  try {
    const db = getDatabase()
    const row = db.prepare(
      'SELECT soul_content FROM agents WHERE id = ? AND workspace_id = ?'
    ).get(task.agent_id, task.workspace_id) as { soul_content: string | null } | undefined
    return row?.soul_content || null
  } catch {
    return null
  }
}

async function callClaudeDirectly(
  task: DispatchableTask,
  prompt: string,
  modelOverride?: string | null,
): Promise<AgentResponseParsed> {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — cannot dispatch without gateway')

  const model = modelOverride || classifyDirectModel(task)
  const soul = getAgentSoulContent(task)

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: prompt },
  ]

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages,
  }

  if (soul) {
    body.system = soul
  }

  logger.info({ taskId: task.id, model, agent: task.agent_name }, 'Dispatching task via direct Claude API')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Claude API ${res.status}: ${errorBody.substring(0, 500)}`)
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  const text = data.content
    ?.filter((b: { type: string }) => b.type === 'text')
    .map((b: { text?: string }) => b.text || '')
    .join('\n') || null

  // Record token usage
  if (data.usage) {
    try {
      const db = getDatabase()
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, total_tokens, cost, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        model,
        `task-${task.id}`,
        data.usage.input_tokens || 0,
        data.usage.output_tokens || 0,
        (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        0, // cost calculated separately
        now,
        task.workspace_id,
      )
    } catch { /* non-fatal */ }
  }

  return { text, sessionId: null }
}

interface ReviewableTask {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  resolution: string | null
  assigned_to: string | null
  agent_config: string | null
  workspace_id: number
  project_id: number | null
  ticket_prefix: string | null
  project_ticket_no: number | null
}

function resolveGatewayAgentIdForReview(task: ReviewableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.openclawId === 'string' && cfg.openclawId) return cfg.openclawId
    } catch { /* ignore */ }
  }
  return task.assigned_to || 'jarv'
}

function buildReviewPrompt(task: ReviewableTask): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You are Aegis, the quality reviewer for Mission Control.',
    'Review the following completed task and its resolution.',
    '',
    `**[${ticket}] ${task.title}**`,
  ]

  if (task.description) {
    lines.push('', '## Task Description', task.description)
  }

  if (task.resolution) {
    lines.push('', '## Agent Resolution', task.resolution.substring(0, 6000))
  }

  lines.push(
    '',
    '## Instructions',
    'Evaluate whether the agent\'s response adequately addresses the task.',
    'Respond with EXACTLY one of these two formats:',
    '',
    'If the work is acceptable:',
    'VERDICT: APPROVED',
    'NOTES: <brief summary of why it passes>',
    '',
    'If the work needs improvement:',
    'VERDICT: REJECTED',
    'NOTES: <specific issues that need to be fixed>',
  )

  return lines.join('\n')
}

function parseReviewVerdict(text: string): { status: 'approved' | 'rejected'; notes: string } {
  const upper = text.toUpperCase()
  const status = upper.includes('VERDICT: APPROVED') ? 'approved' as const : 'rejected' as const
  const notesMatch = text.match(/NOTES:\s*(.+)/i)
  const notes = notesMatch?.[1]?.trim().substring(0, 2000) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed')
  return { status, notes }
}

/**
 * Run Aegis quality reviews on tasks in review-like statuses.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const maxAegisReviewFailures = 3

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.status, t.priority, t.resolution, t.assigned_to, t.workspace_id,
           t.project_id, p.ticket_prefix, t.project_ticket_no, a.config as agent_config
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status IN ('review', 'degraded_execution', 'quality_review', 'verify')
    ORDER BY t.updated_at ASC
    LIMIT 3
  `).all() as ReviewableTask[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No tasks awaiting review' }
  }

  const results: Array<{ id: number; verdict: string; error?: string }> = []

  for (const task of tasks) {
    const previousStatus = task.status

    // Move to verify to prevent re-processing
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('verify', now, task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'verify',
      previous_status: previousStatus,
    })

    try {
      const prompt = buildReviewPrompt(task)
      let callResult: GatewayCallResult

      if (!isGatewayAvailable() && getAnthropicApiKey()) {
        // Direct Claude API review — no gateway needed
        const reviewTask: DispatchableTask = {
          id: task.id, title: task.title, description: task.description,
          status: 'verify', priority: 'high', assigned_to: 'aegis',
          workspace_id: task.workspace_id, agent_name: 'aegis', agent_id: 0,
          agent_config: null, ticket_prefix: task.ticket_prefix,
          project_ticket_no: task.project_ticket_no, project_id: null,
        }
        callResult = {
          response: await callClaudeDirectly(reviewTask, prompt),
          modelFallbackUsed: false,
          attemptedModel: null,
        }
      } else {
        // Resolve the gateway agent ID from config, falling back to assigned_to or default
        const reviewAgent = resolveGatewayAgentIdForReview(task)
        const reviewTask: DispatchableTask = {
          id: task.id,
          title: task.title,
          description: task.description,
          status: 'verify',
          priority: 'high',
          workspace_id: task.workspace_id,
          agent_name: reviewAgent,
          agent_id: 0,
          agent_config: task.agent_config,
          assigned_to: reviewAgent,
          ticket_prefix: task.ticket_prefix,
          project_ticket_no: task.project_ticket_no,
          project_id: task.project_id,
        } as DispatchableTask
        callResult = await runGatewayAgent(reviewTask, prompt, null)
      }

      if (!callResult.response.text) {
        throw new Error('Aegis review returned empty response')
      }

        const verdict = parseReviewVerdict(callResult.response.text)

      // Insert quality review record
      db.prepare(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `).run(task.id, verdict.status, verdict.notes, task.workspace_id)

        if (verdict.status === 'approved') {
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
          .run('done', Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'done',
          previous_status: 'verify',
        })
        syncAndEscalateIfFailed(task, 'done')
      } else {
        // Rejected: check dispatch_attempts to decide next status
        const now = Math.floor(Date.now() / 1000)
        const currentAttempts = (db.prepare('SELECT dispatch_attempts FROM tasks WHERE id = ?').get(task.id) as { dispatch_attempts: number } | undefined)?.dispatch_attempts ?? 0
        const newAttempts = currentAttempts + 1
        const maxAegisRetries = 3
        const currentMeta = parseTaskMetadata((db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata?: string } | undefined)?.metadata)
        currentMeta.harness = {
          ...(currentMeta.harness || {}),
          step: 'owner_gate_review',
          verification: {
            status: verdict.status,
            notes: verdict.notes,
            at: now,
          },
        }
        currentMeta.owner_candidate = true
        currentMeta.caio_attempted_actions = Array.isArray(currentMeta.caio_attempted_actions) ? currentMeta.caio_attempted_actions : []

        if (newAttempts >= maxAegisRetries) {
          db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
            .run('owner_gate_review', `Aegis rejected ${newAttempts} times. Last: ${verdict.notes}`, serializeTaskMetadata(currentMeta), newAttempts, now, task.id)

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'owner_gate_review',
            previous_status: 'verify',
            error_message: `Aegis rejected ${newAttempts} times`,
            reason: 'max_aegis_retries_exceeded',
          })
          syncAndEscalateIfFailed(task, 'owner_gate_review', `Aegis rejected ${newAttempts} times`, newAttempts)
        } else {
          // Requeue to assigned for re-dispatch with feedback
          db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
            .run('assigned', `Aegis rejected: ${verdict.notes}`, newAttempts, now, task.id)

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'assigned',
            previous_status: 'verify',
            error_message: `Aegis rejected: ${verdict.notes}`,
            reason: 'aegis_rejection',
          })
          syncAndEscalateIfFailed(task, 'assigned')
        }

        // Add rejection as a comment so the agent sees it on next dispatch
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'aegis', ?, ?, ?)
        `).run(task.id, `Quality Review Rejected (attempt ${newAttempts}/${maxAegisRetries}):\n${verdict.notes}`, now, task.workspace_id)
      }

      db_helpers.logActivity(
        'aegis_review',
        'task',
        task.id,
        'aegis',
        `Aegis ${verdict.status} task "${task.title}": ${verdict.notes.substring(0, 200)}`,
        { verdict: verdict.status, notes: verdict.notes },
        task.workspace_id
      )

      results.push({ id: task.id, verdict: verdict.status })
      logger.info({ taskId: task.id, verdict: verdict.status }, 'Aegis review completed')
      } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, err }, 'Aegis review failed')

      const existingMeta = parseTaskMetadata((db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata?: string } | undefined)?.metadata)
      const nextFailures = Number(existingMeta.harness?.aegis_review_failures || 0) + 1
      existingMeta.harness = {
        ...(existingMeta.harness || {}),
        step: nextFailures >= maxAegisReviewFailures ? 'owner_gate_review' : 'verify',
        verification: {
          status: 'error',
          notes: errorMsg.substring(0, 2000),
          at: now,
        },
        aegis_review_failures: nextFailures,
      }

      const nextStatus = nextFailures >= maxAegisReviewFailures ? 'owner_gate_review' : 'review'
      const nextError = nextFailures >= maxAegisReviewFailures
        ? `Aegis review failed ${nextFailures} times. Last: ${errorMsg}`
        : `Aegis review failed ${nextFailures}/${maxAegisReviewFailures} times. Last: ${errorMsg}`

      db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, nextError.substring(0, 5000), serializeTaskMetadata(existingMeta), now, task.id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: nextStatus,
        previous_status: 'verify',
        error_message: nextError.substring(0, 500),
        reason: nextFailures >= maxAegisReviewFailures ? 'aegis_review_failed_exceeded' : 'aegis_review_failed',
      })

      if (nextFailures >= maxAegisReviewFailures) {
        syncAndEscalateIfFailed(task, 'owner_gate_review', nextError, nextFailures)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(task.id, 'aegis', `Aegis review invocation failed ${nextFailures} times. Escalated to owner-gate triage.`, now, task.workspace_id)
      }

      results.push({ id: task.id, verdict: 'error', error: errorMsg.substring(0, 100) })
    }
  }

  const approved = results.filter(r => r.verdict === 'approved').length
  const rejected = results.filter(r => r.verdict === 'rejected').length
  const errors = results.filter(r => r.verdict === 'error').length

  return {
    ok: errors === 0,
    message: `Reviewed ${tasks.length}: ${approved} approved, ${rejected} rejected${errors ? `, ${errors} error(s)` : ''}`,
  }
}

/**
 * Requeue stale tasks stuck in 'in_progress'. Active agents are not trusted:
 * when a task stalls beyond the threshold, it is first moved to recovering and
 * then re-assigned on the next stale cycle if still unresolved.
 */
export async function requeueStaleTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const staleThreshold = now - 10 * 60 // 10 minutes
  const maxDispatchRetries = 5

  const staleTasks = db.prepare(`
    SELECT t.id, t.title, t.assigned_to, t.dispatch_attempts, t.workspace_id,
           a.status as agent_status, a.last_seen as agent_last_seen
    FROM tasks t
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'in_progress'
      AND t.updated_at < ?
  `).all(staleThreshold) as Array<{
    id: number; title: string; assigned_to: string | null; dispatch_attempts: number
    workspace_id: number; agent_status: string | null; agent_last_seen: number | null
  }>
  const staleRecoveringTasks = db.prepare(`
    SELECT t.id, t.title, t.assigned_to, t.dispatch_attempts, t.workspace_id
    FROM tasks t
    WHERE t.status = 'recovering'
      AND t.updated_at < ?
  `).all(staleThreshold) as Array<{
    id: number; title: string; assigned_to: string | null; dispatch_attempts: number; workspace_id: number
  }>

  if (staleTasks.length === 0 && staleRecoveringTasks.length === 0) {
    return { ok: true, message: 'No stale tasks found' }
  }

  let requeued = 0
  let recovering = 0
  let failed = 0
  const shouldEscalateStaleOwnerTask = (metadata: ReturnType<typeof parseTaskMetadata>): boolean => {
    return Boolean(
      metadata.owner_candidate
      || metadata.owner_required_reason
      || metadata.harness?.step === 'owner_gate_review',
    )
  }

  for (const task of staleTasks) {
    const newAttempts = (task.dispatch_attempts ?? 0) + 1
    const agentOffline = !task.agent_status || task.agent_status === 'offline'
    const metadata = parseTaskMetadata((db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata?: string } | undefined)?.metadata)
    const staleRecoveryCount = Number((metadata as any)?.stale_recovery_count || 0)

    if (newAttempts >= maxDispatchRetries) {
      if (shouldEscalateStaleOwnerTask(metadata)) {
        metadata.owner_candidate = true
        metadata.owner_required_reason = metadata.owner_required_reason || `Task stalled ${newAttempts} times in in_progress; manual owner review required.`
        metadata.owner_queue_kind = 'auto_guard'
        if (!metadata.owner_queue_entered_at) {
          metadata.owner_queue_entered_at = now
        }
        metadata.harness = {
          ...(metadata.harness || {}),
          step: 'needs_owner',
        }
        db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('needs_owner', 'owner', serializeTaskMetadata(metadata), newAttempts, now, task.id)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'scheduler', ?, ?, ?)
        `).run(task.id, `Stale owner-gate task was escalated to needs_owner after ${newAttempts} failed stale-requeue attempts.`, now, task.workspace_id)
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'needs_owner',
          previous_status: 'in_progress',
          error_message: `Stale task after ${newAttempts} attempts`,
          reason: 'stale_task_owner_gate_escalate',
        })
        failed++
        continue
      }
      metadata.harness = {
        ...(metadata.harness || {}),
        step: 'failed_terminal',
      }
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run('failed_terminal', `Task stuck in_progress ${newAttempts} times — agent "${task.assigned_to}" ${agentOffline ? 'offline' : 'stalled'}. Moved to failed_terminal.`, serializeTaskMetadata(metadata), newAttempts, now, task.id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'failed_terminal',
        previous_status: 'in_progress',
        error_message: `Stale task after ${newAttempts} attempts`,
        reason: 'stale_task_max_retries',
      })

      syncAndEscalateIfFailed(task as any, 'failed_terminal', `Task stuck in_progress ${newAttempts} times`, newAttempts)
      failed++
      continue
    }

    if (!agentOffline && staleRecoveryCount < 1) {
      ;(metadata as any).stale_recovery_count = staleRecoveryCount + 1
      metadata.harness = {
        ...(metadata.harness || {}),
        step: 'recovering',
        resume: {
          ...(metadata.harness?.resume || {}),
          instructions: 'Task was force-recovered after remaining in_progress without updates while the agent stayed online.',
        },
      }
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run('recovering', `Force-recovered stale in_progress task for active agent "${task.assigned_to}"`, newAttempts, serializeTaskMetadata(metadata), now, task.id)
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'scheduler', ?, ?, ?)
      `).run(task.id, `Task moved to recovering (attempt ${newAttempts}/${maxDispatchRetries}): agent "${task.assigned_to}" remained online but task was stale in_progress.`, now, task.workspace_id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'recovering',
        previous_status: 'in_progress',
        error_message: `Agent "${task.assigned_to}" still online, but task stalled`,
        reason: 'stale_task_requeue',
      })
      syncAndEscalateIfFailed(task as any, 'recovering')
      recovering++
      continue
    }

    ;(metadata as any).stale_recovery_count = staleRecoveryCount + 1
    metadata.harness = {
      ...(metadata.harness || {}),
      step: 'assigned',
    }
    db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('assigned', `Requeued stale in_progress task for agent "${task.assigned_to}" (${agentOffline ? 'offline' : 'stalled'})`, newAttempts, serializeTaskMetadata(metadata), now, task.id)

    db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, workspace_id)
      VALUES (?, 'scheduler', ?, ?, ?)
    `).run(task.id, `Task requeued (attempt ${newAttempts}/${maxDispatchRetries}): agent "${task.assigned_to}" ${agentOffline ? 'went offline' : 'remained online but task stalled'} while task was in_progress.`, now, task.workspace_id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'assigned',
      previous_status: 'in_progress',
      error_message: `Agent "${task.assigned_to}" ${agentOffline ? 'went offline' : 'stalled with stale session'}`,
      reason: 'stale_task_requeue',
    })
    syncAndEscalateIfFailed(task as any, 'assigned')
    requeued++
  }

  for (const task of staleRecoveringTasks) {
    const metadata = parseTaskMetadata((db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata?: string } | undefined)?.metadata)
    const newAttempts = (task.dispatch_attempts ?? 0) + 1

    if (newAttempts >= maxDispatchRetries && shouldEscalateStaleOwnerTask(metadata)) {
      metadata.owner_candidate = true
      metadata.owner_required_reason = metadata.owner_required_reason || `Recovering task stalled ${newAttempts} times without progress; manual owner review required.`
      metadata.owner_queue_kind = 'auto_guard'
      if (!metadata.owner_queue_entered_at) {
        metadata.owner_queue_entered_at = now
      }
      metadata.harness = {
        ...(metadata.harness || {}),
        step: 'needs_owner',
      }
      db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run('needs_owner', 'owner', serializeTaskMetadata(metadata), newAttempts, now, task.id)
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'scheduler', ?, ?, ?)
      `).run(task.id, `Recovering task was escalated to needs_owner after ${newAttempts} repeated stale recoveries.`, now, task.workspace_id)
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'needs_owner',
        previous_status: 'recovering',
        error_message: 'Recovering task stale timeout',
        reason: 'recovering_task_owner_gate_escalate',
      })
      failed++
      continue
    }

    ;(metadata as any).stale_recovery_count = Number((metadata as any)?.stale_recovery_count || 0) + 1
    metadata.harness = {
      ...(metadata.harness || {}),
      step: 'assigned',
      resume: {
        ...(metadata.harness?.resume || {}),
        instructions: 'Recovering task was requeued to assigned after exceeding the recovery timeout without progress.',
      },
    }
    db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
      .run('assigned', `Recovering task timed out and was requeued for a fresh attempt`, serializeTaskMetadata(metadata), Number(task.dispatch_attempts || 0), now, task.id)
    db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, workspace_id)
      VALUES (?, 'scheduler', ?, ?, ?)
    `).run(task.id, 'Recovering task timed out without progress and was returned to assigned for a fresh execution attempt.', now, task.workspace_id)
    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'assigned',
      previous_status: 'recovering',
      error_message: 'Recovering task timed out',
      reason: 'recovering_task_requeue',
    })
    syncAndEscalateIfFailed(task as any, 'assigned')
    requeued++
  }

  const total = requeued + recovering + failed
  return {
    ok: true,
    message: total === 0
      ? `Found ${staleTasks.length} stale task(s) but no recovery action was needed`
      : `Recovered ${recovering}, requeued ${requeued}, failed ${failed} of ${staleTasks.length} stale task(s)`,
  }
}

export async function dispatchAssignedTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const resumableTasks = db.prepare(`
    SELECT id, metadata FROM tasks
    WHERE status = 'queued_for_budget_window'
  `).all() as Array<{ id: number; metadata: string | null }>

  const now = Math.floor(Date.now() / 1000)
  for (const resumable of resumableTasks) {
    const metadata = parseTaskMetadata(resumable.metadata)
    const resetAt = Number(metadata?.fallback_route?.reset_at ?? metadata?.harness?.resume?.reset_at ?? 0)
    if (resetAt > 0 && resetAt <= now) {
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run('assigned', now, resumable.id)
    }
  }

  const tasks = db.prepare(`
    SELECT t.*, a.name as agent_name, a.id as agent_id, a.config as agent_config,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status IN ('assigned', 'recovering')
      AND t.assigned_to IS NOT NULL
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      t.created_at ASC
    LIMIT 3
  `).all() as (DispatchableTask & { tags?: string })[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No assigned tasks to dispatch' }
  }

  // Parse JSON tags column
  for (const task of tasks) {
    if (typeof task.tags === 'string') {
      try { task.tags = JSON.parse(task.tags as string) } catch { task.tags = undefined }
    }
  }

  const results: Array<{ id: number; success: boolean; error?: string }> = []
  for (const task of tasks) {
    const preflight = runTaskPreflight(task)
    if (!preflight.ok) {
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run(preflight.status || 'blocked_env', preflight.reason || 'Preflight failed', serializeTaskMetadata(preflight.metadata || {}), now, task.id)
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: preflight.status || 'blocked_env',
        previous_status: 'assigned',
        error_message: preflight.reason,
        reason: 'preflight_blocked',
      })
      results.push({ id: task.id, success: false, error: preflight.reason || 'Preflight failed' })
      continue
    }

    db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('ready', serializeTaskMetadata(preflight.metadata || {}), now, task.id)

    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('in_progress', now, task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'in_progress',
      previous_status: 'ready',
    })

    db_helpers.logActivity(
      'task_dispatched',
      'task',
      task.id,
      'scheduler',
      `Dispatching task "${task.title}" to agent ${task.agent_name}`,
      { agent: task.agent_name, priority: task.priority },
      task.workspace_id
    )

    try {
      // Check for previous Aegis rejection feedback
      const rejectionRow = db.prepare(`
        SELECT content FROM comments
        WHERE task_id = ? AND author = 'aegis' AND content LIKE 'Quality Review Rejected:%'
        ORDER BY created_at DESC LIMIT 1
      `).get(task.id) as { content: string } | undefined
      const rejectionFeedback = rejectionRow?.content?.replace(/^Quality Review Rejected:\n?/, '') || null

      const prompt = buildTaskPrompt(task, rejectionFeedback)

      // Check if task has a target session specified in metadata
      const taskMeta = (() => {
        try {
          const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      const targetSession: string | null = typeof taskMeta?.target_session === 'string' && taskMeta.target_session
        ? taskMeta.target_session
        : null

      let agentResponse: AgentResponseParsed
      const useDirectApi = !isGatewayAvailable() && getAnthropicApiKey()
      const preferredModel = classifyTaskModel(task)
      const budgetDecision = decideBudgetRoute({
        taskId: task.id,
        priority: task.priority,
        preferredModel,
        fallbackModel: deriveFallbackModel(preferredModel),
        workspaceId: task.workspace_id,
      })

      if (budgetDecision.action === 'queue') {
        const queuedMeta = {
          ...taskMeta,
          model_budget: budgetDecision.budget,
          fallback_route: {
            original_model: preferredModel,
            selected_model: null,
            reason: budgetDecision.reason,
            reset_at: budgetDecision.resetAt ?? null,
          },
          harness: {
            ...(taskMeta.harness || {}),
            step: 'queued_for_budget_window',
            resume: {
              ...(taskMeta.harness?.resume || {}),
              reset_at: budgetDecision.resetAt ?? null,
              instructions: 'Requeue after the provider budget reset window.',
            },
          },
        }
        db.prepare('UPDATE tasks SET status = ?, metadata = ?, error_message = ?, updated_at = ? WHERE id = ?')
          .run('queued_for_budget_window', JSON.stringify(queuedMeta), budgetDecision.reason || 'Queued for budget window', Math.floor(Date.now() / 1000), task.id)
        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'queued_for_budget_window',
          previous_status: 'in_progress',
          error_message: budgetDecision.reason,
          reason: 'budget_queue',
        })
        results.push({ id: task.id, success: true })
        continue
      }

      if (useDirectApi && !targetSession) {
        // Direct Claude API dispatch — no gateway needed
        agentResponse = await callClaudeDirectly(
          task,
          prompt,
          (budgetDecision.selectedModel ?? preferredModel)?.replace(/^.*\//, '')
        )
      } else if (targetSession) {
        // Dispatch to a specific existing session via chat.send
        logger.info({ taskId: task.id, targetSession, agent: task.agent_name }, 'Dispatching task to targeted session')
        const sendResult = await callOpenClawGateway<any>(
          'chat.send',
          {
            sessionKey: targetSession,
            message: prompt,
            idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
            deliver: false,
          },
          125_000,
        )
        const status = String(sendResult?.status || '').toLowerCase()
        if (status !== 'started' && status !== 'ok' && status !== 'in_flight') {
          throw new Error(`chat.send to session ${targetSession} returned status: ${status}`)
        }
        // chat.send is fire-and-forget; we record the session but won't get inline response text
        agentResponse = {
          text: `Task dispatched to existing session ${targetSession}. The agent will process it within that session context.`,
          sessionId: sendResult?.runId || targetSession,
        }
      } else {
        // Step 1: Invoke via gateway (new session)
        const gatewayAgentId = resolveGatewayAgentId(task)
        const dispatchModel = budgetDecision.selectedModel ?? preferredModel
        const invokeParams: Record<string, unknown> = {
          message: prompt,
          agentId: gatewayAgentId,
          idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
          deliver: false,
        }
        // Route to appropriate model tier based on task complexity.
        // null = no override, agent uses its own configured default model.
        if (dispatchModel) invokeParams.model = dispatchModel

        // Use --expect-final to block until the agent completes and returns the full
        // response payload (result.payloads[0].text). The two-step agent → agent.wait
        // pattern only returns lifecycle metadata and never includes the agent's text.
        const finalResult = await runOpenClaw(
          ['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000', '--params', JSON.stringify(invokeParams), '--json'],
          { timeoutMs: 125_000 }
        )
        const finalPayload = parseGatewayJson(finalResult.stdout)
          ?? parseGatewayJson(String((finalResult as any)?.stderr || ''))

        agentResponse = parseAgentResponse(
          finalPayload?.result ? JSON.stringify(finalPayload.result) : finalResult.stdout
        )
        if (!agentResponse.sessionId && finalPayload?.result?.meta?.agentMeta?.sessionId) {
          agentResponse.sessionId = finalPayload.result.meta.agentMeta.sessionId
        }
      } // end else (new session dispatch)

      if (!agentResponse.text) {
        throw new Error('Agent returned empty response')
      }

      const truncated = agentResponse.text.length > 10_000
        ? agentResponse.text.substring(0, 10_000) + '\n\n[Response truncated at 10,000 characters]'
        : agentResponse.text

      // Merge dispatch_session_id into existing metadata
      const existingMeta = (() => {
        try {
          const row = db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      existingMeta.model_budget = budgetDecision.budget
      existingMeta.fallback_route = {
        original_model: preferredModel,
        selected_model: budgetDecision.selectedModel ?? preferredModel,
        reason: budgetDecision.reason,
        reset_at: budgetDecision.resetAt ?? null,
      }
      existingMeta.harness = {
        ...(existingMeta.harness || {}),
        step: budgetDecision.action === 'fallback' ? 'degraded_execution' : 'verify',
      }
      if (agentResponse.sessionId) {
        existingMeta.dispatch_session_id = agentResponse.sessionId
      }

      // Update task: status → review, set outcome
      db.prepare(`
        UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?
      `).run(budgetDecision.action === 'fallback' ? 'degraded_execution' : 'review', 'success', truncated, JSON.stringify(existingMeta), Math.floor(Date.now() / 1000), task.id)

      // Add a comment from the agent with the full response
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.agent_name,
        truncated,
        Math.floor(Date.now() / 1000),
        task.workspace_id
      )

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: budgetDecision.action === 'fallback' ? 'degraded_execution' : 'review',
        previous_status: 'in_progress',
      })

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: budgetDecision.action === 'fallback' ? 'degraded_execution' : 'review',
        outcome: 'success',
        assigned_to: task.assigned_to,
        dispatch_session_id: agentResponse.sessionId,
      })
      syncAndEscalateIfFailed(task, budgetDecision.action === 'fallback' ? 'degraded_execution' : 'review')

      db_helpers.logActivity(
        'task_agent_completed',
        'task',
        task.id,
        task.agent_name,
        `Agent completed task "${task.title}" — awaiting review`,
        { response_length: agentResponse.text.length, dispatch_session_id: agentResponse.sessionId },
        task.workspace_id
      )

      results.push({ id: task.id, success: true })
      logger.info({ taskId: task.id, agent: task.agent_name }, 'Task dispatched and completed')
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, agent: task.agent_name, err }, 'Task dispatch failed')

      // Increment dispatch_attempts and decide next status
      const currentAttempts = (db.prepare('SELECT dispatch_attempts FROM tasks WHERE id = ?').get(task.id) as { dispatch_attempts: number } | undefined)?.dispatch_attempts ?? 0
      const newAttempts = currentAttempts + 1
      const maxDispatchRetries = 5

      if (newAttempts >= maxDispatchRetries) {
        // Too many failures — move to failed
        const currentMeta = parseTaskMetadata((db.prepare('SELECT metadata FROM tasks WHERE id = ?').get(task.id) as { metadata?: string } | undefined)?.metadata)
        currentMeta.harness = {
          ...(currentMeta.harness || {}),
          step: 'failed_terminal',
        }
        currentMeta.failure_signature = buildFailureSignature([task.title, errorMsg])
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('failed_terminal', `Dispatch failed ${newAttempts} times. Last: ${errorMsg.substring(0, 5000)}`, serializeTaskMetadata(currentMeta), newAttempts, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'failed_terminal',
          previous_status: 'in_progress',
          error_message: `Dispatch failed ${newAttempts} times`,
          reason: 'max_dispatch_retries_exceeded',
        })
        syncAndEscalateIfFailed(task, 'failed_terminal', `Dispatch failed ${newAttempts} times`, newAttempts)
      } else {
        // Revert to assigned so it can be retried on the next tick
        const nextStatus = /quota|rate limit|usage limit|too many requests|capacity/i.test(errorMsg) ? 'blocked_approval' : 'assigned'
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run(nextStatus, errorMsg.substring(0, 5000), newAttempts, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: nextStatus,
          previous_status: 'in_progress',
          error_message: errorMsg.substring(0, 500),
          reason: 'dispatch_failed',
        })
        syncAndEscalateIfFailed(task, nextStatus)
      }

      db_helpers.logActivity(
        'task_dispatch_failed',
        'task',
        task.id,
        'scheduler',
        `Task dispatch failed for "${task.title}": ${errorMsg.substring(0, 200)}`,
        { error: errorMsg.substring(0, 1000) },
        task.workspace_id
      )

      results.push({ id: task.id, success: false, error: errorMsg.substring(0, 100) })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success)
  const failSummary = failed.length > 0
    ? ` (${failed.length} failed: ${failed.map(f => f.error).join('; ')})`
    : ''

  return {
    ok: failed.length === 0,
    message: `Dispatched ${succeeded}/${tasks.length} tasks${failSummary}`,
  }
}

// ---------------------------------------------------------------------------
// Auto-routing: assign inbox tasks to available agents
// ---------------------------------------------------------------------------

/** Role affinity mapping — which task keywords match which agent roles. */
const ROLE_AFFINITY: Record<string, string[]> = {
  coder: ['code', 'implement', 'build', 'fix', 'bug', 'test', 'unit test', 'refactor', 'feature', 'api', 'endpoint', 'function', 'class', 'module', 'component', 'deploy', 'ci', 'pipeline'],
  researcher: ['research', 'investigate', 'analyze', 'compare', 'find', 'discover', 'audit', 'review', 'survey', 'benchmark', 'evaluate', 'assess', 'competitor', 'market', 'trend'],
  reviewer: ['review', 'audit', 'check', 'verify', 'validate', 'quality', 'security', 'compliance', 'approve'],
  tester: ['test', 'qa', 'e2e', 'integration test', 'regression', 'coverage', 'verify', 'validate'],
  devops: ['deploy', 'infrastructure', 'ci', 'cd', 'docker', 'kubernetes', 'monitoring', 'pipeline', 'server', 'nginx', 'ssl'],
  assistant: ['write', 'draft', 'summarize', 'translate', 'format', 'document', 'docs', 'readme', 'email', 'message', 'report'],
  agent: [], // generic fallback
}

function scoreAgentForTask(
  agent: { name: string; role: string; status: string; config: string | null },
  taskText: string,
): number {
  // Offline agents can't take work
  if (agent.status === 'offline' || agent.status === 'error' || agent.status === 'sleeping') return -1

  const text = taskText.toLowerCase()
  const keywords = ROLE_AFFINITY[agent.role] || []

  let score = 0
  // Role keyword match
  for (const kw of keywords) {
    if (text.includes(kw)) score += 10
  }

  // Idle agents get a bonus (prefer agents not currently busy)
  if (agent.status === 'idle') score += 5

  // Check agent capabilities from config
  if (agent.config) {
    try {
      const cfg = JSON.parse(agent.config)
      const caps = Array.isArray(cfg.capabilities) ? cfg.capabilities : []
      for (const cap of caps) {
        if (typeof cap === 'string' && text.includes(cap.toLowerCase())) score += 15
      }
    } catch { /* ignore */ }
  }

  // Any non-offline agent gets at least 1 (can be a fallback)
  return Math.max(score, 1)
}

/**
 * Auto-route inbox tasks to the best available agent.
 * Runs before dispatch — moves tasks from inbox → assigned.
 */
export async function autoRouteInboxTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const inboxTasks = db.prepare(`
    SELECT id, title, description, priority, tags, workspace_id
    FROM tasks
    WHERE status = 'inbox' AND assigned_to IS NULL
    ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      created_at ASC
    LIMIT 5
  `).all() as Array<{ id: number; title: string; description: string | null; priority: string; tags: string | null; workspace_id: number }>

  if (inboxTasks.length === 0) {
    return { ok: true, message: 'No inbox tasks to route' }
  }

  // Get all non-hidden, non-offline agents
  const agents = db.prepare(`
    SELECT id, name, role, status, config
    FROM agents
    WHERE hidden = 0 AND status NOT IN ('offline', 'error')
    LIMIT 50
  `).all() as Array<{ id: number; name: string; role: string; status: string; config: string | null }>

  if (agents.length === 0) {
    return { ok: true, message: `${inboxTasks.length} inbox task(s) but no available agents` }
  }

  let routed = 0
  const now = Math.floor(Date.now() / 1000)

  for (const task of inboxTasks) {
    const taskText = `${task.title} ${task.description || ''}`
    let parsedTags: string[] = []
    if (task.tags) {
      try { parsedTags = JSON.parse(task.tags) } catch { /* ignore */ }
    }
    const fullText = `${taskText} ${parsedTags.join(' ')}`

    // Score each agent
    const scored = agents
      .map(a => ({ agent: a, score: scoreAgentForTask(a, fullText) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) continue

    const best = scored[0].agent

    // Check capacity — skip agents with 3+ in-progress tasks
    const inProgressCount = (db.prepare(
      'SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = \'in_progress\' AND workspace_id = ?'
    ).get(best.name, task.workspace_id) as { c: number }).c

    if (inProgressCount >= 3) {
      // Try next best agent
      const alt = scored.find(s => {
        const c = (db.prepare(
          'SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = \'in_progress\' AND workspace_id = ?'
        ).get(s.agent.name, task.workspace_id) as { c: number }).c
        return c < 3
      })
      if (!alt) continue // all agents at capacity
      db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?')
        .run('assigned', alt.agent.name, now, task.id)

      db_helpers.logActivity('task_auto_routed', 'task', task.id, 'scheduler',
        `Auto-assigned "${task.title}" to ${alt.agent.name} (${alt.agent.role}, score: ${alt.score})`,
        { agent: alt.agent.name, role: alt.agent.role, score: alt.score },
        task.workspace_id)

      eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'inbox', assigned_to: alt.agent.name })
      syncAndEscalateIfFailed(task as any, 'assigned')
      routed++
      continue
    }

    db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?')
      .run('assigned', best.name, now, task.id)

    db_helpers.logActivity('task_auto_routed', 'task', task.id, 'scheduler',
      `Auto-assigned "${task.title}" to ${best.name} (${best.role}, score: ${scored[0].score})`,
      { agent: best.name, role: best.role, score: scored[0].score },
      task.workspace_id)

    eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'inbox', assigned_to: best.name })
    syncAndEscalateIfFailed(task as any, 'assigned')
    routed++
  }

  return {
    ok: true,
    message: routed > 0
      ? `Auto-routed ${routed}/${inboxTasks.length} inbox task(s)`
      : `${inboxTasks.length} inbox task(s), no suitable agents found`,
  }
}
