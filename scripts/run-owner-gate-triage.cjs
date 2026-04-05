#!/usr/bin/env node

const path = require('path')
const { execFileSync } = require('child_process')
const Database = require('better-sqlite3')

const ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(ROOT, '.data', 'mission-control.db')
const LIMIT = Math.max(1, Number(process.argv[2] || 15) || 15)
const CAIO_TIMEOUT_MS = 120_000
const VALID_AGENTS = new Set(['FE', 'BE', 'CTO', 'Data', 'Designer', 'DevOps', 'QA', 'Security', 'Automation', 'Trader'])
const OWNER_ONLY_RE = /\b(api[_ -]?key|token|secret|credential|oauth|login|billing|payment|invoice|certificate|tls|ssl|private[_ -]?key|signoff)\b/i
const TITLE_PREFIX_RE = /^\[(FE|BE|CTO|Data|Designer|DevOps|QA|Security|Automation|Trader)\]/

function nowTs() {
  return Math.floor(Date.now() / 1000)
}

function parseMetadata(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function stringifyMetadata(meta) {
  return JSON.stringify(meta || {})
}

function isOwnerOnlyTask(task) {
  return OWNER_ONLY_RE.test(`${task.title || ''}\n${task.description || ''}`)
}

function buildPrompt(tasks) {
  const lines = [
    '## CAIO owner gate triage',
    '',
    '아래 태스크들이 owner queue로 가기 전에 CAIO 판단이 필요합니다.',
    '진짜 owner-only 작업이 아니면 owner queue로 보내지 마세요.',
    '',
    '### 가능한 조치',
    '- redefine: 태스크 범위/설명을 재정의하여 재할당. file path, function, step을 newDescription에 명시.',
    '- reassign: 다른 에이전트에게 재할당.',
    '- recover: 복구 플랜과 함께 실행 큐로 되돌림.',
    '- request_approval: 간단한 승인/권한 요청만 필요. blocked_approval로 이동.',
    '- escalate_owner: API key/token/secret/login/billing 등 진짜 owner-only일 때만 사용.',
    '- cancel: 중복이거나 불필요한 태스크를 취소.',
    '',
    '### 태스크 목록',
    '',
  ]

  for (const task of tasks) {
    const meta = parseMetadata(task.metadata)
    lines.push(
      `#### Task ID: ${task.id} - ${task.title}`,
      `- taskId: ${task.id}`,
      `- 담당: ${task.assigned_to || 'N/A'}`,
      `- 실패 사유: ${task.error_message || meta.awaiting_reason || 'N/A'}`,
      `- dispatch 시도: ${meta.dispatch_attempts || 0}회`,
    )
    if (task.description) lines.push(`- 설명: ${String(task.description).slice(0, 400)}`)
    lines.push('')
  }

  lines.push(
    '### RESPONSE FORMAT',
    '',
    'JSON array ONLY. No markdown, no explanations.',
    'Each: {"taskId": number, "action": "redefine"|"reassign"|"recover"|"request_approval"|"escalate_owner"|"cancel", "targetAgent": "FE"|"BE"|..., "reason": "...", "newTitle": "...", "newDescription": "..."}',
    '',
    'Valid agents: FE, BE, CTO, Data, Designer, DevOps, QA, Security, Automation, Trader',
    '',
    'Rules:',
    '- API key/token/secret/login/billing only => escalate_owner.',
    '- "no code changes" failures => redefine with concrete newDescription.',
    '- repeated failures => narrow scope in newDescription.',
    '- duplicate/meaningless => cancel.',
    '- respond for ALL tasks.',
  )

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
    if (parsed?.payloads?.[0]?.text) return parsed.payloads[0].text
    if (parsed?.result) return String(parsed.result)
    if (parsed?.output) return String(parsed.output)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return String(stdout || '').trim()
  }
}

function parseDecisions(text, taskIds) {
  const decisions = []
  const candidateMatch = String(text || '').match(/\[[\s\S]*\]/)
  const candidate = candidateMatch ? candidateMatch[0] : String(text || '')
  try {
    const parsed = JSON.parse(candidate)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of arr) {
      const taskId = Number(item?.taskId)
      const action = String(item?.action || '').toLowerCase()
      if (!taskIds.has(taskId)) continue
      if (!['reassign', 'redefine', 'recover', 'request_approval', 'escalate_owner', 'cancel'].includes(action)) continue
      const targetAgent = typeof item?.targetAgent === 'string' && VALID_AGENTS.has(item.targetAgent) ? item.targetAgent : undefined
      decisions.push({
        taskId,
        action,
        targetAgent,
        newTitle: typeof item?.newTitle === 'string' && item.newTitle.trim() ? item.newTitle.trim() : undefined,
        newDescription: typeof item?.newDescription === 'string' && item.newDescription.trim() ? item.newDescription.trim() : undefined,
        reason: String(item?.reason || '').slice(0, 500) || 'CAIO triage',
      })
    }
  } catch {
    return []
  }
  return decisions
}

function addComment(db, task, author, content) {
  db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
    .run(task.id, author, content, nowTs(), task.workspace_id)
}

function fallbackTarget(task) {
  const prefix = String(task.title || '').match(TITLE_PREFIX_RE)?.[1]
  return prefix || task.assigned_to || 'CTO'
}

function invokeCaio(prompt) {
  const invokeParams = {
    message: prompt,
    agentId: 'admin',
    idempotencyKey: `owner-gate-triage-${Date.now()}`,
    deliver: false,
  }
  const stdout = execFileSync('openclaw', [
    'gateway', 'call', 'agent',
    '--expect-final',
    '--timeout', String(CAIO_TIMEOUT_MS),
    '--params', JSON.stringify(invokeParams),
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
    SELECT t.id, t.title, t.description, t.metadata, t.assigned_to, t.workspace_id, t.error_message
    FROM tasks t
    WHERE t.status IN ('owner_gate_review', 'awaiting_owner')
    ORDER BY t.updated_at ASC
    LIMIT ?
  `).all(LIMIT)

  if (tasks.length === 0) {
    console.log(JSON.stringify({ ok: true, message: 'No owner-gate tasks to process' }))
    return
  }

  const ownerOnly = tasks.filter(isOwnerOnlyTask)
  const triageable = tasks.filter(task => !isOwnerOnlyTask(task))
  const results = {
    scanned: tasks.length,
    needs_owner: 0,
    reassigned: 0,
    redefined: 0,
    recovering: 0,
    approvals: 0,
    cancelled: 0,
    fallback_reassigned: 0,
  }

  const updateOwner = db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?')
  const updateGeneral = db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, error_message = NULL, dispatch_attempts = 0, updated_at = ? WHERE id = ?')
  const updateApproval = db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
  const updateCancel = db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const task of ownerOnly) {
      const meta = parseMetadata(task.metadata)
      meta.owner_candidate = true
      meta.owner_required_reason = meta.owner_required_reason || 'credential_or_human_only_action'
      meta.owner_action = meta.owner_action || 'manual_owner_intervention'
      meta.harness = { ...(meta.harness || {}), step: 'needs_owner' }
      updateOwner.run('needs_owner', 'owner', stringifyMetadata(meta), nowTs(), task.id)
      addComment(db, task, 'CAIO', '이 태스크는 진짜 owner-only 작업으로 판정되었습니다. API 키/시크릿/로그인/결제 등 사람 개입이 필요합니다.')
      results.needs_owner++
    }

    if (triageable.length === 0) return

    let decisions = []
    try {
      const responseText = invokeCaio(buildPrompt(triageable))
      decisions = parseDecisions(responseText, new Set(triageable.map(task => task.id)))
    } catch {
      decisions = []
    }

    const decided = new Set()
    for (const decision of decisions) {
      const task = triageable.find(item => item.id === decision.taskId)
      if (!task) continue
      decided.add(task.id)
      const meta = parseMetadata(task.metadata)
      delete meta.blocker_class
      meta.caio_triage_at = nowTs()
      meta.caio_triage_action = decision.action
      meta.caio_gate_decision = decision.action
      meta.caio_triage_reason = decision.reason
      meta.caio_reassign_count = Number(meta.caio_reassign_count || 0) + 1

      if (decision.action === 'request_approval') {
        meta.blocker_class = 'approval'
        meta.harness = {
          ...(meta.harness || {}),
          step: 'blocked_approval',
          blockers: [
            ...(Array.isArray(meta?.harness?.blockers) ? meta.harness.blockers : []),
            { class: 'approval', reason: decision.reason },
          ],
        }
        updateApproval.run('blocked_approval', stringifyMetadata(meta), nowTs(), task.id)
        addComment(db, task, 'CAIO', `CAIO owner gate -> blocked_approval\n사유: ${decision.reason}`)
        results.approvals++
        continue
      }

      if (decision.action === 'escalate_owner') {
        meta.owner_candidate = true
        meta.owner_required_reason = meta.owner_required_reason || decision.reason
        meta.owner_action = meta.owner_action || 'manual_owner_intervention'
        meta.harness = {
          ...(meta.harness || {}),
          step: 'needs_owner',
          blockers: [
            ...(Array.isArray(meta?.harness?.blockers) ? meta.harness.blockers : []),
            { class: 'owner', reason: decision.reason },
          ],
        }
        updateOwner.run('needs_owner', 'owner', stringifyMetadata(meta), nowTs(), task.id)
        addComment(db, task, 'CAIO', `CAIO owner gate -> needs_owner\n사유: ${decision.reason}`)
        results.needs_owner++
        continue
      }

      if (decision.action === 'cancel') {
        meta.harness = { ...(meta.harness || {}), step: 'cancelled' }
        updateCancel.run('cancelled', stringifyMetadata(meta), nowTs(), task.id)
        addComment(db, task, 'CAIO', `CAIO 트리아지 -> 취소\n사유: ${decision.reason}`)
        results.cancelled++
        continue
      }

      const nextStatus = decision.action === 'recover' ? 'recovering' : 'assigned'
      const target = decision.targetAgent || fallbackTarget(task)
      meta.harness = { ...(meta.harness || {}), step: nextStatus }
      const updates = ['status = ?', 'assigned_to = ?', 'metadata = ?', 'error_message = NULL', 'dispatch_attempts = 0', 'updated_at = ?']
      const params = [nextStatus, target, stringifyMetadata(meta), nowTs()]
      if (decision.newTitle) {
        updates.push('title = ?')
        params.push(decision.newTitle)
      }
      if (decision.newDescription) {
        updates.push('description = ?')
        params.push(decision.newDescription)
      }
      params.push(task.id)
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      addComment(db, task, 'CAIO', `CAIO owner gate -> ${decision.action}: ${target}\n사유: ${decision.reason}${decision.newDescription ? `\n새 설명: ${decision.newDescription.slice(0, 500)}` : ''}`)
      if (decision.action === 'redefine') results.redefined++
      else if (decision.action === 'recover') results.recovering++
      else results.reassigned++
    }

    for (const task of triageable) {
      if (decided.has(task.id)) continue
      const target = fallbackTarget(task)
      const meta = parseMetadata(task.metadata)
      delete meta.blocker_class
      meta.caio_reassign_count = Number(meta.caio_reassign_count || 0) + 1
      meta.harness = { ...(meta.harness || {}), step: 'assigned' }
      updateGeneral.run('assigned', target, stringifyMetadata(meta), nowTs(), task.id)
      addComment(db, task, 'system', `Auto-reassign (fallback): owner_gate_review -> assigned (${target})`)
      results.fallback_reassigned++
    }
  })

  tx()
  console.log(JSON.stringify({ ok: true, results }))
}

main()
