import { getDatabase, db_helpers } from './db'
import { callOpenClawGateway } from './openclaw-gateway'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { config } from './config'
import { getAllGatewaySessions } from './sessions'
import { parseJsonlTranscript, readSessionJsonl, type TranscriptMessage } from './transcript-parser'
import { syncTaskOutbound } from './github-sync-engine'

const AGENT_DISPATCH_ACCEPT_TIMEOUT_MS = 60_000

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
}

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------

/**
 * Return an explicit gateway model override from Mission Control agent config.
 *
 * By default, task dispatch should not inject a model override; the OpenClaw
 * agent should use its own configured default model. A Mission Control agent
 * may still opt into an override via agent.config.dispatchModel.
 */
export function resolveTaskDispatchModelOverride(task: Pick<DispatchableTask, 'agent_config'>): string | null {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) return cfg.dispatchModel
      if (typeof cfg.model === 'string' && cfg.model) return null
      if (cfg.model && typeof cfg.model === 'object' && typeof cfg.model.primary === 'string' && cfg.model.primary) return null
    } catch { /* ignore */ }
  }
  return null
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

interface AgentResponseParsed {
  text: string | null
  sessionId: string | null
}

interface DeferredCompletionTask {
  id: number
  title: string
  assigned_to: string | null
  metadata: string | null
  workspace_id: number
  ticket_prefix: string | null
  project_ticket_no: number | null
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

function safeParseMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function extractDeferredCompletionText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  const nestedCandidates = [
    waitPayload.result?.text,
    waitPayload.result?.message,
    waitPayload.result?.response,
    waitPayload.result?.output,
    waitPayload.output?.text,
    waitPayload.output?.message,
    waitPayload.output?.content,
  ]
  for (const value of nestedCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  const arrays = [
    waitPayload.payloads,
    waitPayload.result?.payloads,
    waitPayload.output,
    waitPayload.result?.output,
  ]
  const parts: string[] = []
  for (const list of arrays) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text === 'string' && item.text.trim()) {
        parts.push(item.text.trim())
      }
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (!block || typeof block !== 'object') continue
          const blockType = String(block.type || '')
          if ((blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim())
          }
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n').slice(0, 10_000) : null
}

function isCompletionStatus(status: string): boolean {
  return ['completed', 'complete', 'success', 'succeeded', 'done', 'ok'].includes(status)
}

function normalizeGatewayIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function buildDeferredCompletionMarkers(task: DeferredCompletionTask): string[] {
  const markers = new Set<string>([
    `TASK-${task.id}`,
    `TASK-${String(task.id).padStart(3, '0')}`,
  ])

  if (task.ticket_prefix && task.project_ticket_no) {
    markers.add(`${task.ticket_prefix}-${task.project_ticket_no}`)
    markers.add(`${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`)
  }

  return [...markers]
}

function getTranscriptText(message: TranscriptMessage): string {
  return message.parts
    .map((part) => part.type === 'text' ? part.text.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function findAssistantTextAfterTaskPrompt(rawTranscript: string, task: DeferredCompletionTask): string | null {
  const messages = parseJsonlTranscript(rawTranscript, 2000)
  if (messages.length === 0) return null

  const markers = buildDeferredCompletionMarkers(task).map((marker) => marker.toLowerCase())

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue

    const userText = getTranscriptText(message).toLowerCase()
    if (!markers.some((marker) => userText.includes(marker))) continue

    for (let j = i + 1; j < messages.length; j++) {
      const candidate = messages[j]
      if (candidate.role !== 'assistant') continue
      const text = getTranscriptText(candidate)
      if (text) return text.slice(0, 10_000)
    }
  }

  return null
}

function recoverDeferredCompletionTextFromTranscript(
  task: DeferredCompletionTask,
  metadata: Record<string, any>,
): string | null {
  if (!config.openclawStateDir) return null

  const dispatchSessionId = normalizeGatewayIdentifier(metadata.dispatch_session_id)
  const assignedAgent = normalizeGatewayIdentifier(task.assigned_to)
  const agentCandidates = new Set<string>(
    [dispatchSessionId, assignedAgent].filter((value): value is string => Boolean(value))
  )

  if (agentCandidates.size === 0) return null

  const sessions = getAllGatewaySessions(24 * 60 * 60 * 1000, true)
    .filter((session) => {
      const sessionAgent = normalizeGatewayIdentifier(session.agent)
      const sessionId = normalizeGatewayIdentifier(session.sessionId)
      const sessionKey = normalizeGatewayIdentifier(session.key)
      return Boolean(
        (sessionAgent && agentCandidates.has(sessionAgent)) ||
        (dispatchSessionId && sessionId === dispatchSessionId) ||
        (dispatchSessionId && sessionKey === dispatchSessionId)
      )
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  for (const session of sessions) {
    if (!session.agent || !session.sessionId) continue
    const rawTranscript = readSessionJsonl(config.openclawStateDir, session.agent, session.sessionId)
    if (!rawTranscript) continue
    const text = findAssistantTextAfterTaskPrompt(rawTranscript, task)
    if (text) return text
  }

  return null
}

async function waitForDeferredRun(runId: string): Promise<{ complete: boolean; text: string | null }> {
  const waitPayload = await callOpenClawGateway<any>(
    'agent.wait',
    { runId, timeoutMs: 1000 },
    3000,
  )
  const status = String(waitPayload?.status || waitPayload?.result?.status || '').toLowerCase()
  if (!isCompletionStatus(status)) {
    return { complete: false, text: null }
  }
  return {
    complete: true,
    text: extractDeferredCompletionText(waitPayload),
  }
}

export async function reconcileDeferredTaskCompletions(options: {
  workspaceId?: number
  taskId?: number
  limit?: number
  waitForRun?: (runId: string) => Promise<{ complete: boolean; text: string | null }>
} = {}): Promise<{ ok: boolean; message: string; checked: number; promoted: number }> {
  const db = getDatabase()
  const workspaceId = options.workspaceId ?? 1
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20))
  const waitForRun = options.waitForRun ?? waitForDeferredRun
  const now = Math.floor(Date.now() / 1000)

  const params: unknown[] = [workspaceId]
  let query = `
    SELECT t.id, t.title, t.assigned_to, t.metadata, t.workspace_id,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.workspace_id = ?
      AND t.status = 'in_progress'
      AND t.metadata IS NOT NULL
      AND t.metadata LIKE '%"async_state"%'
      AND t.metadata LIKE '%"pending"%'
  `
  if (options.taskId !== undefined) {
    query += ' AND t.id = ?'
    params.push(options.taskId)
  }
  query += ' ORDER BY t.updated_at ASC LIMIT ?'
  params.push(limit)

  const tasks = db.prepare(query).all(...params) as DeferredCompletionTask[]
  let promoted = 0

  for (const task of tasks) {
    const metadata = safeParseMetadata(task.metadata)
    if (metadata.async_state !== 'pending') continue

    const runId = typeof metadata.dispatch_run_id === 'string' && metadata.dispatch_run_id.trim()
      ? metadata.dispatch_run_id.trim()
      : typeof metadata.dispatchRunId === 'string' && metadata.dispatchRunId.trim()
        ? metadata.dispatchRunId.trim()
        : typeof metadata.runId === 'string' && metadata.runId.trim()
          ? metadata.runId.trim()
          : null
    if (!runId) continue

    let completion: { complete: boolean; text: string | null }
    try {
      completion = await waitForRun(runId)
    } catch (err) {
      logger.warn({ err, taskId: task.id, runId }, 'Deferred task completion check failed')
      continue
    }
    if (!completion.complete) continue

    const recoveredText = completion.text?.trim() || recoverDeferredCompletionTextFromTranscript(task, metadata)
    const resolution = recoveredText || 'Deferred agent run completed without textual output.'
    const truncated = resolution.length > 10_000
      ? resolution.substring(0, 10_000) + '\n\n[Response truncated at 10,000 characters]'
      : resolution
    const nextMetadata: Record<string, any> = {
      ...metadata,
      async_state: 'completed',
      async_completed_at: now,
    }

    const update = db.prepare(`
      UPDATE tasks
      SET status = 'review',
          outcome = 'success',
          resolution = ?,
          metadata = ?,
          updated_at = ?
      WHERE id = ?
        AND workspace_id = ?
        AND status = 'in_progress'
    `).run(truncated, JSON.stringify(nextMetadata), now, task.id, task.workspace_id)

    if (update.changes === 0) continue

    db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(task.id, task.assigned_to || 'agent', truncated, now, task.workspace_id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'review',
      previous_status: 'in_progress',
    })
    eventBus.broadcast('task.updated', {
      id: task.id,
      status: 'review',
      outcome: 'success',
      assigned_to: task.assigned_to,
      dispatch_session_id: nextMetadata.dispatch_session_id,
      dispatch_run_id: nextMetadata.dispatch_run_id,
    })

    db_helpers.logActivity(
      'task_agent_completed',
      'task',
      task.id,
      task.assigned_to || 'agent',
      `Deferred agent completed task "${task.title}" - awaiting review`,
      { response_length: truncated.length, dispatch_session_id: nextMetadata.dispatch_session_id, dispatch_run_id: nextMetadata.dispatch_run_id },
      task.workspace_id
    )

    promoted++
  }

  return {
    ok: true,
    checked: tasks.length,
    promoted,
    message: promoted > 0
      ? `Promoted ${promoted}/${tasks.length} deferred task(s) to review`
      : `Checked ${tasks.length} deferred task(s); none completed`,
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
): Promise<AgentResponseParsed> {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — cannot dispatch without gateway')

  const model = classifyDirectModel(task)
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
 * Run Aegis quality reviews on tasks in 'review' status.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.status, t.priority, t.resolution, t.assigned_to, t.workspace_id,
           t.project_id, p.ticket_prefix, t.project_ticket_no, a.config as agent_config
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'review'
    ORDER BY t.updated_at ASC
    LIMIT 3
  `).all() as ReviewableTask[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No tasks awaiting review' }
  }

  const results: Array<{ id: number; verdict: string; error?: string }> = []

  for (const task of tasks) {
    // Move to quality_review to prevent re-processing
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('quality_review', Math.floor(Date.now() / 1000), task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'quality_review',
      previous_status: 'review',
    })

    try {
      const prompt = buildReviewPrompt(task)
      let agentResponse: AgentResponseParsed

      if (!isGatewayAvailable() && getAnthropicApiKey()) {
        // Direct Claude API review — no gateway needed
        const reviewTask: DispatchableTask = {
          id: task.id, title: task.title, description: task.description,
          status: 'quality_review', priority: 'high', assigned_to: 'aegis',
          workspace_id: task.workspace_id, agent_name: 'aegis', agent_id: 0,
          agent_config: null, ticket_prefix: task.ticket_prefix,
          project_ticket_no: task.project_ticket_no, project_id: null,
        }
        agentResponse = await callClaudeDirectly(reviewTask, prompt)
      } else {
        // Resolve the gateway agent ID from config, falling back to assigned_to or default
        const reviewAgent = resolveGatewayAgentIdForReview(task)

        const invokeParams = {
          message: prompt,
          agentId: reviewAgent,
          idempotencyKey: `aegis-review-${task.id}-${Date.now()}`,
          deliver: false,
        }
        const finalPayload = await callOpenClawGateway<any>(
          'agent',
          invokeParams,
          125_000,
          { expectFinal: true },
        )
        agentResponse = parseAgentResponse(
          finalPayload?.result ? JSON.stringify(finalPayload.result) : JSON.stringify(finalPayload)
        )
      }

      if (!agentResponse.text) {
        throw new Error('Aegis review returned empty response')
      }

      const verdict = parseReviewVerdict(agentResponse.text)

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
          previous_status: 'quality_review',
        })
        syncAndEscalateIfFailed(task, 'done')
      } else {
        // Rejected: check dispatch_attempts to decide next status
        const now = Math.floor(Date.now() / 1000)
        const currentAttempts = (db.prepare('SELECT dispatch_attempts FROM tasks WHERE id = ?').get(task.id) as { dispatch_attempts: number } | undefined)?.dispatch_attempts ?? 0
        const newAttempts = currentAttempts + 1
        const maxAegisRetries = 3

        if (newAttempts >= maxAegisRetries) {
          // Too many rejections — move to failed
          db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
            .run('failed', `Aegis rejected ${newAttempts} times. Last: ${verdict.notes}`, newAttempts, now, task.id)

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'failed',
            previous_status: 'quality_review',
            error_message: `Aegis rejected ${newAttempts} times`,
            reason: 'max_aegis_retries_exceeded',
          })
          syncAndEscalateIfFailed(task, 'failed', `Aegis rejected ${newAttempts} times`, newAttempts)
        } else {
          // Requeue to assigned for re-dispatch with feedback
          db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
            .run('assigned', `Aegis rejected: ${verdict.notes}`, newAttempts, now, task.id)

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'assigned',
            previous_status: 'quality_review',
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

      // Revert to review so it can be retried
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run('review', Math.floor(Date.now() / 1000), task.id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'review',
        previous_status: 'quality_review',
      })

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
 * Requeue stale tasks stuck in 'in_progress' whose assigned agent is offline.
 * Prevents tasks from being permanently stuck when agents crash or disconnect.
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

  if (staleTasks.length === 0) {
    return { ok: true, message: 'No stale tasks found' }
  }

  let requeued = 0
  let failed = 0

  for (const task of staleTasks) {
    // Only requeue if the agent is offline or unknown
    const agentOffline = !task.agent_status || task.agent_status === 'offline'
    if (!agentOffline) continue

    const newAttempts = (task.dispatch_attempts ?? 0) + 1

    if (newAttempts >= maxDispatchRetries) {
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run('failed', `Task stuck in_progress ${newAttempts} times — agent "${task.assigned_to}" offline. Moved to failed.`, newAttempts, now, task.id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'failed',
        previous_status: 'in_progress',
        error_message: `Stale task — agent offline after ${newAttempts} attempts`,
        reason: 'stale_task_max_retries',
      })

      syncAndEscalateIfFailed(task as any, 'failed', `Task stuck in_progress ${newAttempts} times`, newAttempts)
      failed++
    } else {
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run('assigned', `Requeued: agent "${task.assigned_to}" went offline while task was in_progress`, newAttempts, now, task.id)

      // Add a comment explaining the requeue
      db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'scheduler', ?, ?, ?)
      `).run(task.id, `Task requeued (attempt ${newAttempts}/${maxDispatchRetries}): agent "${task.assigned_to}" went offline while task was in_progress.`, now, task.workspace_id)

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'assigned',
        previous_status: 'in_progress',
        error_message: `Agent "${task.assigned_to}" went offline`,
        reason: 'stale_task_requeue',
      })
      syncAndEscalateIfFailed(task as any, 'assigned')

      requeued++
    }
  }

  const total = requeued + failed
  return {
    ok: true,
    message: total === 0
      ? `Found ${staleTasks.length} stale task(s) but agents still online`
      : `Requeued ${requeued}, failed ${failed} of ${staleTasks.length} stale task(s)`,
  }
}

export async function dispatchAssignedTasks(): Promise<{ ok: boolean; message: string }> {
  const db = getDatabase()

  const tasks = db.prepare(`
    SELECT t.*, a.name as agent_name, a.id as agent_id, a.config as agent_config,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'assigned'
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
  const now = Math.floor(Date.now() / 1000)

  for (const task of tasks) {
    // Mark as in_progress immediately to prevent re-dispatch
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('in_progress', now, task.id)

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'in_progress',
      previous_status: 'assigned',
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

      if (useDirectApi && !targetSession) {
        // Direct Claude API dispatch — no gateway needed
        agentResponse = await callClaudeDirectly(task, prompt)
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
        if (status !== 'started' && status !== 'ok' && status !== 'in_flight' && status !== 'accepted') {
          throw new Error(`chat.send to session ${targetSession} returned status: ${status}`)
        }
        // chat.send is fire-and-forget. Only runs with a runId can be safely
        // reconciled by agent.wait; accepted sends without one need explicit
        // manual/later recovery instead of looking pending forever.
        const dispatchRunId = typeof sendResult?.runId === 'string' && sendResult.runId.trim()
          ? sendResult.runId.trim()
          : null
        const asyncState = dispatchRunId ? 'pending' : 'accepted_without_run_id'
        const pendingMeta: Record<string, any> = {
          ...taskMeta,
          target_session: targetSession,
          dispatch_session_id: targetSession,
          ...(dispatchRunId ? { dispatch_run_id: dispatchRunId } : {
            async_reconciliation: 'manual_required',
            async_warning: 'chat.send accepted without a runId; automatic completion reconciliation cannot safely wait on this session.',
          }),
          async_state: asyncState,
          async_dispatched_at: Math.floor(Date.now() / 1000),
        }
        db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(pendingMeta), Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.updated', {
          id: task.id,
          status: 'in_progress',
          assigned_to: task.assigned_to,
          dispatch_session_id: targetSession,
          dispatch_run_id: pendingMeta.dispatch_run_id,
          async_state: asyncState,
        })

        db_helpers.logActivity(
          dispatchRunId ? 'task_deferred_dispatch' : 'task_deferred_dispatch_unreconcilable',
          'task',
          task.id,
          'scheduler',
          dispatchRunId
            ? `Deferred task "${task.title}" to existing session ${targetSession}`
            : `Accepted task "${task.title}" in existing session ${targetSession} without a runId; manual reconciliation required`,
          { dispatch_session_id: targetSession, dispatch_run_id: pendingMeta.dispatch_run_id, async_state: asyncState },
          task.workspace_id
        )

        results.push({ id: task.id, success: true })
        continue
      } else {
        // Step 1: Invoke via gateway (new session)
        const gatewayAgentId = resolveGatewayAgentId(task)
        const dispatchModel = resolveTaskDispatchModelOverride(task)
        const invokeParams: Record<string, unknown> = {
          message: prompt,
          agentId: gatewayAgentId,
          idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
          deliver: false,
        }
        // Route to appropriate model tier based on task complexity.
        // null = no override, agent uses its own configured default model.
        if (dispatchModel) invokeParams.model = dispatchModel

        const acceptedPayload = await callOpenClawGateway<any>(
          'agent',
          invokeParams,
          AGENT_DISPATCH_ACCEPT_TIMEOUT_MS,
        )
        const status = String(acceptedPayload?.status || '').toLowerCase()
        if (status && !['started', 'ok', 'in_flight', 'accepted'].includes(status)) {
          throw new Error(`agent dispatch returned status: ${status}`)
        }

        const dispatchRunId = typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId.trim()
          ? acceptedPayload.runId.trim()
          : null
        const dispatchSessionId = typeof acceptedPayload?.sessionId === 'string' && acceptedPayload.sessionId.trim()
          ? acceptedPayload.sessionId.trim()
          : typeof acceptedPayload?.session_id === 'string' && acceptedPayload.session_id.trim()
            ? acceptedPayload.session_id.trim()
            : gatewayAgentId
        const asyncState = dispatchRunId ? 'pending' : 'accepted_without_run_id'
        const pendingMeta: Record<string, any> = {
          ...taskMeta,
          dispatch_session_id: dispatchSessionId,
          ...(dispatchRunId ? { dispatch_run_id: dispatchRunId } : {
            async_reconciliation: 'manual_required',
            async_warning: 'agent dispatch accepted without a runId; automatic completion reconciliation cannot safely wait on this run.',
          }),
          async_state: asyncState,
          async_dispatched_at: Math.floor(Date.now() / 1000),
        }
        db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(pendingMeta), Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.updated', {
          id: task.id,
          status: 'in_progress',
          assigned_to: task.assigned_to,
          dispatch_session_id: dispatchSessionId,
          dispatch_run_id: pendingMeta.dispatch_run_id,
          async_state: asyncState,
        })

        db_helpers.logActivity(
          dispatchRunId ? 'task_deferred_dispatch' : 'task_deferred_dispatch_unreconcilable',
          'task',
          task.id,
          'scheduler',
          dispatchRunId
            ? `Deferred task "${task.title}" to agent ${task.agent_name}`
            : `Accepted task "${task.title}" for agent ${task.agent_name} without a runId; manual reconciliation required`,
          { dispatch_session_id: dispatchSessionId, dispatch_run_id: pendingMeta.dispatch_run_id, async_state: asyncState },
          task.workspace_id
        )

        results.push({ id: task.id, success: true })
        continue
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
      if (agentResponse.sessionId) {
        existingMeta.dispatch_session_id = agentResponse.sessionId
      }

      // Update task: status → review, set outcome
      db.prepare(`
        UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?
      `).run('review', 'success', truncated, JSON.stringify(existingMeta), Math.floor(Date.now() / 1000), task.id)

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
        status: 'review',
        previous_status: 'in_progress',
      })

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: 'review',
        outcome: 'success',
        assigned_to: task.assigned_to,
        dispatch_session_id: agentResponse.sessionId,
      })
      syncAndEscalateIfFailed(task, 'review')

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
        const failureMessage = `Dispatch failed ${newAttempts} times. Last: ${errorMsg.substring(0, 5000)}`
        // Too many failures — move to failed
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('failed', failureMessage, newAttempts, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'failed',
          previous_status: 'in_progress',
          error_message: failureMessage,
          reason: 'max_dispatch_retries_exceeded',
        })
        syncAndEscalateIfFailed(task, 'failed', `Dispatch failed ${newAttempts} times`, newAttempts)
      } else {
        // Revert to assigned so it can be retried on the next tick
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('assigned', errorMsg.substring(0, 5000), newAttempts, Math.floor(Date.now() / 1000), task.id)

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'assigned',
          previous_status: 'in_progress',
          error_message: errorMsg.substring(0, 500),
          reason: 'dispatch_failed',
        })
        syncAndEscalateIfFailed(task, 'assigned')
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
