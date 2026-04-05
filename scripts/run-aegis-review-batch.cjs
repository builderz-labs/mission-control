#!/usr/bin/env node

const path = require('path')
const { execFileSync } = require('child_process')
const Database = require('better-sqlite3')

const ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(ROOT, '.data', 'mission-control.db')
const LIMIT = Math.max(1, Number(process.argv[2] || 3) || 3)
const REVIEW_TIMEOUT_MS = 120_000

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

function resolveGatewayAgentIdForReview(task) {
  const cfg = parseJson(task.agent_config || '{}', {})
  return typeof cfg.openclawId === 'string' && cfg.openclawId ? cfg.openclawId : (task.assigned_to || 'jarv')
}

function buildReviewPrompt(task) {
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
    lines.push('', '## Agent Resolution', String(task.resolution).slice(0, 6000))
  }

  lines.push(
    '',
    '## Instructions',
    'Evaluate whether the agent response adequately addresses the task.',
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

function parseReviewVerdict(text) {
  const upper = String(text || '').toUpperCase()
  const status = upper.includes('VERDICT: APPROVED') ? 'approved' : 'rejected'
  const notesMatch = String(text || '').match(/NOTES:\s*(.+)/i)
  const notes = notesMatch?.[1]?.trim().slice(0, 2000) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed')
  return { status, notes }
}

function classifyRejectedVerdict(notes) {
  const text = String(notes || '').toLowerCase()

  const envSignals = [
    'workspace',
    'worktree',
    'not available',
    'isn’t available',
    "isn't available",
    'service or endpoint',
    'service is missing',
    'endpoint is missing',
    'repo is missing',
    'repository is missing',
    'environment',
    'not configured',
    'missing service',
    'required stockpulse workspace',
  ]
  if (envSignals.some(signal => text.includes(signal))) {
    return 'blocked_env'
  }

  const noImplSignals = [
    'no implementation',
    'not implemented',
    'no code',
    'no tests were delivered',
    'no implementation or testing',
    'does not provide code or tests',
    'response only mentions pending pytest approvals',
    'awaiting pytest approvals',
    'task not done',
    'quality check failed',
  ]
  if (noImplSignals.some(signal => text.includes(signal))) {
    return 'no_impl'
  }

  return 'generic'
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
    if (parsed?.payloads?.[0]?.text) return parsed.payloads[0].text
    if (parsed?.result) return String(parsed.result)
    if (parsed?.output) return String(parsed.output)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return String(stdout || '').trim()
  }
}

function invokeReview(task, prompt) {
  const params = {
    message: prompt,
    agentId: resolveGatewayAgentIdForReview(task),
    idempotencyKey: `aegis-review-${task.id}-${Date.now()}`,
    deliver: false,
  }
  const stdout = execFileSync('openclaw', [
    'gateway', 'call', 'agent',
    '--expect-final',
    '--timeout', String(REVIEW_TIMEOUT_MS),
    '--params', JSON.stringify(params),
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const payload = parseGatewayJson(stdout)
  return parseAgentResponse(payload?.result ? JSON.stringify(payload.result) : stdout)
}

function main() {
  const db = new Database(DB_PATH)
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.status, t.priority, t.resolution, t.assigned_to, t.workspace_id,
           t.project_id, t.project_ticket_no, t.metadata, t.dispatch_attempts, a.config as agent_config, p.ticket_prefix
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status IN ('review', 'degraded_execution', 'quality_review')
    ORDER BY t.updated_at ASC
    LIMIT ?
  `).all(LIMIT)

  const results = []

  for (const task of tasks) {
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run('verify', nowTs(), task.id)

    try {
      const responseText = invokeReview(task, buildReviewPrompt(task))
      if (!responseText) throw new Error('Aegis review returned empty response')

      const verdict = parseReviewVerdict(responseText)
      db.prepare('INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'aegis', verdict.status, verdict.notes, task.workspace_id)

      if (verdict.status === 'approved') {
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
          .run('done', nowTs(), task.id)
        results.push({ id: task.id, verdict: 'approved' })
        continue
      }

      const newAttempts = Number(task.dispatch_attempts || 0) + 1
      const maxAegisRetries = 3
      const rejectClass = classifyRejectedVerdict(verdict.notes)
      const meta = parseMetadata(task.metadata)
      delete meta.blocker_class
      meta.harness = {
        ...(meta.harness || {}),
        verification: {
          status: verdict.status,
          notes: verdict.notes,
          at: nowTs(),
        },
      }
      meta.caio_attempted_actions = Array.isArray(meta.caio_attempted_actions) ? meta.caio_attempted_actions : []

      if (rejectClass === 'blocked_env') {
        meta.blocker_class = 'environment'
        meta.harness.step = 'blocked_env'
        meta.harness.blockers = Array.isArray(meta.harness.blockers) ? meta.harness.blockers : []
        meta.harness.blockers.push({
          class: 'environment',
          reason: verdict.notes,
        })
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('blocked_env', `Aegis blocked by environment: ${verdict.notes}`, stringifyMetadata(meta), newAttempts, nowTs(), task.id)
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'aegis', `Quality Review Blocked (environment):\n${verdict.notes}`, nowTs(), task.workspace_id)
        results.push({ id: task.id, verdict: 'rejected', next_status: 'blocked_env' })
        continue
      }

      const escalateEarly = rejectClass === 'no_impl' && newAttempts >= 2
      if (rejectClass === 'no_impl') meta.blocker_class = 'implementation'
      meta.harness.step = 'owner_gate_review'
      meta.owner_candidate = true

      if (newAttempts >= maxAegisRetries || escalateEarly) {
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('owner_gate_review', `Aegis rejected ${newAttempts} times. Last: ${verdict.notes}`, stringifyMetadata(meta), newAttempts, nowTs(), task.id)
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'aegis', `Quality Review Rejected (attempt ${newAttempts}/${maxAegisRetries}) -> owner_gate_review:\n${verdict.notes}`, nowTs(), task.workspace_id)
        results.push({ id: task.id, verdict: 'rejected', next_status: 'owner_gate_review' })
      } else {
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
          .run('assigned', `Aegis rejected: ${verdict.notes}`, newAttempts, nowTs(), task.id)
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'aegis', `Quality Review Rejected (attempt ${newAttempts}/${maxAegisRetries}):\n${verdict.notes}`, nowTs(), task.workspace_id)
        results.push({ id: task.id, verdict: 'rejected', next_status: 'assigned' })
      }
    } catch (error) {
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run('review', nowTs(), task.id)
      results.push({ id: task.id, verdict: 'error', error: String(error?.message || error || 'Unknown error').slice(0, 200) })
    }
  }

  console.log(JSON.stringify({ ok: true, processed: results.length, results }))
}

main()
