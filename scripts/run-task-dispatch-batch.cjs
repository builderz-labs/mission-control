#!/usr/bin/env node

const path = require('path')
const { execFileSync } = require('child_process')
const Database = require('better-sqlite3')

const ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(ROOT, '.data', 'mission-control.db')
const LIMIT = Math.max(1, Number(process.argv[2] || 3) || 3)
const DISPATCH_TIMEOUT_MS = 120_000

function nowTs() {
  return Math.floor(Date.now() / 1000)
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function parseMetadata(raw) {
  return parseJson(raw || '{}', {})
}

function stringifyMetadata(meta) {
  return JSON.stringify(meta || {})
}

function buildTaskPrompt(task, rejectionFeedback) {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You have been assigned a task in Mission Control.',
    '',
    `**[${ticket}] ${task.title}**`,
    `Priority: ${task.priority}`,
  ]

  if (Array.isArray(task.tags) && task.tags.length > 0) {
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

function parseGatewayJson(raw) {
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

function parseAgentResponse(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const sessionId = typeof parsed?.sessionId === 'string'
      ? parsed.sessionId
      : typeof parsed?.session_id === 'string'
        ? parsed.session_id
        : null
    if (parsed?.payloads?.[0]?.text) return { text: parsed.payloads[0].text, sessionId }
    if (parsed?.result) return { text: String(parsed.result), sessionId }
    if (parsed?.output) return { text: String(parsed.output), sessionId }
    return { text: JSON.stringify(parsed, null, 2), sessionId }
  } catch {
    return { text: String(stdout || '').trim() || null, sessionId: null }
  }
}

function classifyTaskModel(task) {
  if (task.agent_config) {
    const cfg = parseJson(task.agent_config, {})
    if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) return cfg.dispatchModel
  }

  const text = `${task.title} ${task.description || ''}`.toLowerCase()
  const priority = String(task.priority || '').toLowerCase()
  const complexSignals = ['debug', 'diagnos', 'architect', 'security audit', 'root cause', 'investigate', 'incident', 'failure', 'broken', 'refactor', 'migration', 'performance optim']
  if (priority === 'critical' || complexSignals.some(signal => text.includes(signal))) {
    return '9router/cc/claude-opus-4-6'
  }
  const routineSignals = ['status check', 'health check', 'ping', 'format', 'rename', 'update readme', 'send message', 'summarize', 'translate', 'quick ', 'simple ', 'minor ']
  if (priority === 'low' && routineSignals.some(signal => text.includes(signal))) {
    return '9router/cc/claude-haiku-4-5-20251001'
  }
  return null
}

function deriveFallbackModel(model) {
  if (!model) return null
  if (model.includes('opus')) return '9router/cc/claude-sonnet-4-6'
  if (model.includes('gpt-5') || model.includes('openai')) return 'gpt-5-mini'
  if (model.includes('sonnet')) return '9router/cc/claude-haiku-4-5-20251001'
  return null
}

function resolveGatewayAgentId(task) {
  const cfg = parseJson(task.agent_config || '{}', {})
  return typeof cfg.openclawId === 'string' && cfg.openclawId ? cfg.openclawId : task.agent_name
}

function runTaskPreflight(task) {
  const metadata = parseMetadata(task.metadata)
  const checks = []
  let blockedStatus
  let reason

  if (metadata.implementation_repo) {
    const repo = String(metadata.implementation_repo).trim()
    const ok = repo.startsWith('/') || repo.includes('/')
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
          checked_at: nowTs(),
          ok: !blockedStatus,
          checks,
        },
      },
    },
  }
}

function invokeAgent(task, prompt, modelOverride) {
  const params = {
    message: prompt,
    agentId: resolveGatewayAgentId(task),
    idempotencyKey: `task-dispatch-${task.id}-${Date.now()}`,
    deliver: false,
  }
  if (modelOverride) params.model = modelOverride
  const stdout = execFileSync('openclaw', [
    'gateway', 'call', 'agent',
    '--expect-final',
    '--timeout', String(DISPATCH_TIMEOUT_MS),
    '--params', JSON.stringify(params),
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const payload = parseGatewayJson(stdout)
  const response = parseAgentResponse(payload?.result ? JSON.stringify(payload.result) : stdout)
  if (!response.sessionId && payload?.result?.meta?.agentMeta?.sessionId) {
    response.sessionId = payload.result.meta.agentMeta.sessionId
  }
  return response
}

function main() {
  const db = new Database(DB_PATH)
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
    LIMIT ?
  `).all(LIMIT)

  const results = []

  for (const task of tasks) {
    if (typeof task.tags === 'string') {
      task.tags = parseJson(task.tags, undefined)
    }

    const preflight = runTaskPreflight(task)
    if (!preflight.ok) {
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run(preflight.status || 'blocked_env', preflight.reason || 'Preflight failed', stringifyMetadata(preflight.metadata || {}), nowTs(), task.id)
      results.push({ id: task.id, status: preflight.status || 'blocked_env', ok: false, reason: preflight.reason })
      continue
    }

    db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('ready', stringifyMetadata(preflight.metadata || {}), nowTs(), task.id)
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('in_progress', nowTs(), task.id)

    try {
      const rejectionRow = db.prepare(`
        SELECT content FROM comments
        WHERE task_id = ? AND author = 'aegis' AND content LIKE 'Quality Review Rejected:%'
        ORDER BY created_at DESC LIMIT 1
      `).get(task.id)
      const rejectionFeedback = rejectionRow?.content?.replace(/^Quality Review Rejected:\n?/, '') || null
      const preferredModel = classifyTaskModel(task)
      const dispatchModel = deriveFallbackModel(preferredModel) || preferredModel
      const response = invokeAgent(task, buildTaskPrompt(task, rejectionFeedback), dispatchModel)

      if (!response.text) {
        throw new Error('Agent returned empty response')
      }

      const truncated = response.text.length > 10000
        ? `${response.text.slice(0, 10000)}\n\n[Response truncated at 10,000 characters]`
        : response.text

      const meta = parseMetadata(task.metadata)
      meta.harness = { ...(meta.harness || {}), step: dispatchModel && dispatchModel !== preferredModel ? 'degraded_execution' : 'verify' }
      if (response.sessionId) meta.dispatch_session_id = response.sessionId
      meta.fallback_route = {
        original_model: preferredModel,
        selected_model: dispatchModel,
        reason: dispatchModel && dispatchModel !== preferredModel ? 'dispatch script fallback routing' : 'default routing',
        reset_at: null,
      }

      const nextStatus = dispatchModel && dispatchModel !== preferredModel ? 'degraded_execution' : 'review'
      db.prepare('UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, 'success', truncated, stringifyMetadata(meta), nowTs(), task.id)
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, task.agent_name, truncated, nowTs(), task.workspace_id)
      results.push({ id: task.id, status: nextStatus, ok: true, agent: task.agent_name })
    } catch (error) {
      const errorMsg = String(error?.message || error || 'Unknown error').slice(0, 5000)
      const currentAttempts = Number(task.dispatch_attempts || 0) + 1
      const nextStatus = /quota|rate limit|usage limit|too many requests|capacity/i.test(errorMsg) ? 'blocked_approval' : 'assigned'
      db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, errorMsg, currentAttempts, nowTs(), task.id)
      results.push({ id: task.id, status: nextStatus, ok: false, reason: errorMsg.slice(0, 200) })
    }
  }

  console.log(JSON.stringify({ ok: true, processed: results.length, results }))
}

main()
