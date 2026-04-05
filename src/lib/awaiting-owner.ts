/**
 * Awaiting-Owner Triage
 *
 * Processes tasks stuck in 'awaiting_owner' status:
 *   1. Owner-only tasks (API keys, secrets) → reassign to 'owner'
 *   2. Merge conflicts → attempt auto-merge via gh CLI
 *   3. Repeated failures → CAIO root-cause analysis + redefine/reassign
 *
 * Runs every 5 minutes via scheduler.
 */

import { db_helpers, getDatabase } from './db'
import { parseGatewayJsonOutput } from './openclaw-gateway'
import { runCommand, runOpenClaw } from './command'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { isTrueOwnerRequired, parseTaskMetadata, serializeTaskMetadata } from './task-harness'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRIAGE_BATCH_SIZE = 15
const CAIO_TIMEOUT_MS = 120_000
const FALLBACK_REASSIGN_LIMIT = 3
const OWNER_GATE_RETRY_LIMIT = 6
const SETTINGS_OWNER_GATE_REVIEW_STALE_TTL_HOURS_KEY = 'automation.owner_gate_review_stale_ttl_hours'
const SETTINGS_NEEDS_OWNER_TRANSIENT_TTL_HOURS_KEY = 'automation.needs_owner_transient_ttl_hours'
const SETTINGS_NEEDS_OWNER_OWNER_ONLY_TTL_HOURS_KEY = 'automation.needs_owner_owner_only_ttl_hours'
const SETTINGS_OWNER_QUEUE_NOTIFICATION_RECIPIENTS_KEY = 'automation.owner_queue_notification_recipients'
const SETTINGS_OWNER_GATE_CONFLICT_RETRY_LIMIT_KEY = 'automation.owner_gate_conflict_resolution_retry_limit'

const OWNER_GATE_REVIEW_STALE_TTL_HOURS_DEFAULT = 168
const NEEDS_OWNER_TRANSIENT_TTL_HOURS_DEFAULT = 6
const NEEDS_OWNER_OWNER_ONLY_TTL_HOURS_DEFAULT = 72
const OWNER_QUEUE_NOTIFICATION_RECIPIENTS_DEFAULT = 'admin'
const OWNER_GATE_CONFLICT_RETRY_LIMIT_DEFAULT = 3

interface OwnerQueuePolicy {
  ownerGateReviewStaleTtlSeconds: number
  needsOwnerTransientTtlSeconds: number
  needsOwnerOwnerOnlyTtlSeconds: number
  ownerGateConflictResolutionRetryLimit: number
  notificationRecipients: string[]
}

type NeedsOwnerQueueKind = 'owner_only' | 'auto_guard'

// ---------------------------------------------------------------------------
// Owner-only detection
// ---------------------------------------------------------------------------

function isOwnerOnlyTask(title: string, description: string | null): boolean {
  return isTrueOwnerRequired({ title, description })
}

function readNumberSetting(db: ReturnType<typeof getDatabase>, key: string, defaultValue: number): number {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    const parsed = Number.parseFloat(String(row?.value ?? '').trim())
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return parsed
  } catch {
    return defaultValue
  }
}

function readStringSetting(db: ReturnType<typeof getDatabase>, key: string, defaultValue: string): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    const value = String(row?.value ?? '').trim()
    return value || defaultValue
  } catch {
    return defaultValue
  }
}

function parseNotificationRecipients(raw: string): string[] {
  const recipients = (raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => Boolean(v))
    .filter((v, i, arr) => arr.indexOf(v) === i)

  return recipients.length > 0 ? recipients : [OWNER_QUEUE_NOTIFICATION_RECIPIENTS_DEFAULT]
}

function getOwnerQueuePolicy(db: ReturnType<typeof getDatabase>): OwnerQueuePolicy {
  const ownerGateReviewTtlHours = readNumberSetting(
    db,
    SETTINGS_OWNER_GATE_REVIEW_STALE_TTL_HOURS_KEY,
    OWNER_GATE_REVIEW_STALE_TTL_HOURS_DEFAULT,
  )
  const needsOwnerTransientTtlHours = readNumberSetting(
    db,
    SETTINGS_NEEDS_OWNER_TRANSIENT_TTL_HOURS_KEY,
    NEEDS_OWNER_TRANSIENT_TTL_HOURS_DEFAULT,
  )
  const needsOwnerOwnerOnlyTtlHours = readNumberSetting(
    db,
    SETTINGS_NEEDS_OWNER_OWNER_ONLY_TTL_HOURS_KEY,
    NEEDS_OWNER_OWNER_ONLY_TTL_HOURS_DEFAULT,
  )
  const ownerGateConflictRetryLimit = readNumberSetting(
    db,
    SETTINGS_OWNER_GATE_CONFLICT_RETRY_LIMIT_KEY,
    OWNER_GATE_CONFLICT_RETRY_LIMIT_DEFAULT,
  )
  const rawRecipients = readStringSetting(
    db,
    SETTINGS_OWNER_QUEUE_NOTIFICATION_RECIPIENTS_KEY,
    OWNER_QUEUE_NOTIFICATION_RECIPIENTS_DEFAULT,
  )

  return {
    ownerGateReviewStaleTtlSeconds: ownerGateReviewTtlHours * 3600,
    needsOwnerTransientTtlSeconds: needsOwnerTransientTtlHours * 3600,
    needsOwnerOwnerOnlyTtlSeconds: needsOwnerOwnerOnlyTtlHours * 3600,
    ownerGateConflictResolutionRetryLimit: Math.max(1, Math.floor(ownerGateConflictRetryLimit)),
    notificationRecipients: parseNotificationRecipients(rawRecipients),
  }
}

function sendOwnerQueueNotification(
  db: ReturnType<typeof getDatabase>,
  policy: OwnerQueuePolicy,
  task: { id: number; title: string; assigned_to: string | null; workspace_id: number },
  fromStatus: string,
  toStatus: string,
  reason: string,
) {
  const recipients = new Set(policy.notificationRecipients)
  if (task.assigned_to) recipients.add(task.assigned_to)

  for (const recipient of recipients) {
    try {
      db_helpers.createNotification(
        recipient,
        'owner_queue',
        `자동 owner 큐 이동: Task #${task.id}`,
        `${task.title}\n\n${fromStatus} → ${toStatus}\n사유: ${reason}`,
        'task',
        task.id,
        task.workspace_id,
      )
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AwaitingTask {
  id: number
  title: string
  description: string | null
  metadata: string | null
  assigned_to: string | null
  workspace_id: number
  error_message: string | null
  github_pr_state: string | null
  github_pr_number: number | null
  github_branch: string | null
  github_repo: string | null
  github_default_branch: string | null
  dispatch_attempts: number | null
}

interface NeedsOwnerTask {
  id: number
  title: string
  workspace_id: number
  metadata: string | null
  updated_at: number
}

interface OwnerGateTask {
  id: number
  title: string
  assigned_to: string | null
  metadata: string | null
  workspace_id: number
  updated_at: number
}

function escalateStaleOwnerGateTasks(
  db: ReturnType<typeof getDatabase>,
  policy: OwnerQueuePolicy,
  now: number,
): number {
  const cutoff = now - policy.ownerGateReviewStaleTtlSeconds
  let escalatedCount = 0
  const staleTasks = db.prepare(`
    SELECT id, title, assigned_to, metadata, workspace_id
    FROM tasks
    WHERE status = 'owner_gate_review'
      AND updated_at < ?
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(cutoff, TRIAGE_BATCH_SIZE) as OwnerGateTask[]

  for (const task of staleTasks) {
    const meta = parseTaskMetadata(task.metadata)
    const elapsedHours = (now - task.updated_at) / 3600
    const thresholdHours = policy.ownerGateReviewStaleTtlSeconds / 3600
    markNeedsOwnerTransition(
      meta,
      'auto_guard',
      `owner_gate_review 상태가 ${thresholdHours}시간 이상 유지되어 owner 검토 큐로 전환`,
    )
    db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('needs_owner', 'owner', serializeTaskMetadata(meta), now, task.id)
    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(
        task.id,
        'system',
        `owner_gate_review 장기 정체로 needs_owner 전환했습니다. (${thresholdHours}h)`,
        now,
        task.workspace_id,
      )
    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'needs_owner',
      previous_status: 'owner_gate_review',
      error_message: 'owner_gate_review_stale',
      reason: 'owner_gate_review_ttl',
    })
    sendOwnerQueueNotification(
      db,
      policy,
      task,
      'owner_gate_review',
      'needs_owner',
      `stale owner_gate_review (${elapsedHours.toFixed(1)}h)`,
    )
    logger.warn({ taskId: task.id, title: task.title, assignedTo: task.assigned_to }, 'owner_gate_review task auto-escalated due stale')
    escalatedCount++
  }

  return escalatedCount
}

type TriageAction = 'reassign' | 'redefine' | 'recover' | 'request_approval' | 'escalate_owner' | 'cancel'

interface TriageDecision {
  taskId: number
  action: TriageAction
  targetAgent?: string
  newTitle?: string
  newDescription?: string
  reason: string
}

function markNeedsOwnerTransition(
  meta: ReturnType<typeof parseTaskMetadata>,
  queueKind: NeedsOwnerQueueKind,
  reason: string,
): void {
  meta.owner_candidate = true
  meta.owner_required_reason = meta.owner_required_reason || reason
  meta.owner_queue_kind = queueKind
  if (!meta.owner_queue_entered_at) meta.owner_queue_entered_at = Math.floor(Date.now() / 1000)
  meta.harness = {
    ...(meta.harness || {}),
    step: 'needs_owner',
  }
}

function inferNeedsOwnerQueueKind(meta: ReturnType<typeof parseTaskMetadata>): NeedsOwnerQueueKind {
  if (meta.owner_queue_kind === 'owner_only') return 'owner_only'
  if (meta.owner_queue_kind === 'auto_guard') return 'auto_guard'

  const reason = String(meta.owner_required_reason || '').toLowerCase()
  const ownerOnlySignals = ['api key', 'api_key', 'apikey', 'token', 'secret', 'credential', 'billing', 'payment', '로그인', '시크릿', '결제', 'oauth', 'login']
  const isOwnerOnly = ownerOnlySignals.some(signal => reason.includes(signal))
  return isOwnerOnly ? 'owner_only' : 'auto_guard'
}

function pruneTransientNeedsOwnerTasks(
  db: ReturnType<typeof getDatabase>,
  policy: OwnerQueuePolicy,
  now: number,
): number {
  const cutoff = now - Math.max(policy.needsOwnerTransientTtlSeconds, policy.needsOwnerOwnerOnlyTtlSeconds)
  let expiredCount = 0
  const staleNeedsOwner = db.prepare(`
    SELECT id, title, workspace_id, metadata, updated_at
    FROM tasks
    WHERE status = 'needs_owner'
      AND json_valid(COALESCE(metadata, '{}'))
      AND json_extract(metadata, '$.owner_candidate') = 1
      AND (
        json_extract(metadata, '$.owner_queue_kind') = 'auto_guard'
        OR json_extract(metadata, '$.owner_queue_kind') = 'owner_only'
        OR json_extract(metadata, '$.owner_queue_kind') IS NULL
      )
      AND updated_at < ?
    ORDER BY updated_at ASC
  `).all(cutoff) as NeedsOwnerTask[]

  for (const task of staleNeedsOwner) {
    const meta = parseTaskMetadata(task.metadata)
    const queueKind = inferNeedsOwnerQueueKind(meta)
    const ttl = queueKind === 'owner_only' ? policy.needsOwnerOwnerOnlyTtlSeconds : policy.needsOwnerTransientTtlSeconds
    const enteredRaw = meta.owner_queue_entered_at
    const enteredAt = Number.isFinite(Number(enteredRaw)) ? Number(enteredRaw) : Number(task.updated_at || 0)
    if (!Number.isFinite(enteredAt) || enteredAt <= 0 || enteredAt >= (now - ttl)) {
      continue
    }

    const expirationHours = ttl / 3600
    const expirationReason = `needs_owner ${queueKind} TTL(${expirationHours}h) 초과로 owner 개입 필요 항목 처리 실패 판정`
    meta.owner_queue_expired_at = now
    meta.owner_queue_expiry_reason = expirationReason
    meta.harness = {
      ...(meta.harness || {}),
      step: 'failed_terminal',
    }
    db.prepare('UPDATE tasks SET status = ?, error_message = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('failed_terminal', expirationReason, serializeTaskMetadata(meta), now, task.id)
    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.id, 'system', `needs_owner 항목이 ${expirationHours}시간 내 처리되지 않아 실패 처리됩니다.`, now, task.workspace_id)
    sendOwnerQueueNotification(
      db,
      policy,
      { id: task.id, title: task.title, assigned_to: null, workspace_id: task.workspace_id },
      'needs_owner',
      'failed_terminal',
      expirationReason,
    )
    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'failed_terminal',
      previous_status: 'needs_owner',
      error_message: 'needs_owner_ttl_expired',
      reason: 'needs_owner_queue_ttl',
    })
    logger.warn({ taskId: task.id, title: task.title, queueKind, queueEnteredAt: enteredAt }, 'needs_owner queue item expired')
    expiredCount++
  }

  return expiredCount
}

// ---------------------------------------------------------------------------
// Owner-only → assign to 'owner'
// ---------------------------------------------------------------------------

function handleOwnerOnlyTasks(db: ReturnType<typeof getDatabase>, tasks: AwaitingTask[]): number {
  const now = Math.floor(Date.now() / 1000)
  const policy = getOwnerQueuePolicy(db)
  let count = 0
  for (const task of tasks) {
    const meta = parseTaskMetadata(task.metadata)
    meta.owner_candidate = true
    meta.owner_required_reason = meta.owner_required_reason || 'credential_or_human_only_action'
    meta.owner_queue_kind = 'owner_only'
    meta.owner_queue_entered_at = now
    meta.harness = {
      ...(meta.harness || {}),
      step: 'needs_owner',
    }
    db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run('needs_owner', 'owner', serializeTaskMetadata(meta), now, task.id)
    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.id, 'CAIO', '이 태스크는 진짜 owner-only 작업으로 판정되었습니다. API 키/시크릿/로그인/결제 등 사람 개입이 필요합니다.', now, task.workspace_id)
    eventBus.broadcast('task.status_changed', { id: task.id, status: 'needs_owner', previous_status: 'owner_gate_review' })
    sendOwnerQueueNotification(
      db,
      policy,
      { id: task.id, title: task.title, assigned_to: 'owner', workspace_id: task.workspace_id },
      'owner_gate_review',
      'needs_owner',
      'true owner-only task flagged by detection rule',
    )
    count++
    logger.info({ taskId: task.id, title: task.title }, 'Owner-only task reassigned to owner')
  }
  return count
}

// ---------------------------------------------------------------------------
// Merge conflict → auto-resolution via gh CLI
// ---------------------------------------------------------------------------

async function handleConflictTasks(
  db: ReturnType<typeof getDatabase>,
  tasks: AwaitingTask[],
  policy: OwnerQueuePolicy,
): Promise<{ resolved: number; failed: number; escalated: number }> {
  let resolved = 0
  let failed = 0
  let escalated = 0
  const now = Math.floor(Date.now() / 1000)

  for (const task of tasks) {
    if (!task.github_pr_number || !task.github_repo) {
      failed++
      continue
    }

    const repo = task.github_repo
    const pr = task.github_pr_number
    const meta = parseTaskMetadata(task.metadata)
    const conflictAttempt = Number(meta.conflict_resolution_attempt_count || 0) + 1
    meta.conflict_resolution_attempt_count = conflictAttempt

    if (conflictAttempt > policy.ownerGateConflictResolutionRetryLimit) {
      const escalationReason = `PR 충돌 자동 해결을 ${conflictAttempt - 1}회 시도했으나 처리되지 않아 owner 개입이 필요합니다.`
      markNeedsOwnerTransition(meta, 'auto_guard', escalationReason)
      db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, error_message = ?, updated_at = ? WHERE id = ?')
        .run('needs_owner', 'owner', serializeTaskMetadata(meta), escalationReason, now, task.id)
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'system', `PR #${pr} 충돌 자동 해결 시도 횟수 초과로 수동 owner 검토 대상으로 이동.`, now, task.workspace_id)
      sendOwnerQueueNotification(
        db,
        policy,
        task,
        'owner_gate_review',
        'needs_owner',
        escalationReason,
      )
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'needs_owner',
        previous_status: 'owner_gate_review',
        error_message: 'owner_gate_conflict_retry_limit',
        reason: 'owner_gate_conflict_resolution_limit',
      })
      escalated++
      logger.warn({ taskId: task.id, pr, conflictAttempt }, 'Conflict task escalated to needs_owner after retry limit')
      continue
    }

    // Attempt 1: direct merge (conflict may have been resolved by other merges)
    try {
      await runCommand('gh', [
        'pr', 'merge', String(pr), '--repo', repo, '--squash', '--delete-branch',
      ], { timeoutMs: 30_000 })

      db.prepare('UPDATE tasks SET status = ?, github_pr_state = ?, updated_at = ? WHERE id = ?')
        .run('done', 'merged', now, task.id)
      eventBus.broadcast('task.status_changed', { id: task.id, status: 'done', previous_status: 'owner_gate_review' })
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'system', `PR #${pr} 자동 머지 성공 (충돌 해소됨).`, now, task.workspace_id)
      resolved++
      logger.info({ taskId: task.id, pr }, 'Conflict task auto-merged')
      continue
    } catch {
      // Direct merge failed, try rebase
    }

    // Attempt 2: update PR branch (rebase)
    try {
      await runCommand('gh', [
        'pr', 'update-branch', String(pr), '--repo', repo, '--rebase',
      ], { timeoutMs: 60_000 })

      // Wait briefly then retry merge
      await new Promise(r => setTimeout(r, 3000))

      await runCommand('gh', [
        'pr', 'merge', String(pr), '--repo', repo, '--squash', '--delete-branch',
      ], { timeoutMs: 30_000 })

      db.prepare('UPDATE tasks SET status = ?, github_pr_state = ?, updated_at = ? WHERE id = ?')
        .run('done', 'merged', now, task.id)
      eventBus.broadcast('task.status_changed', { id: task.id, status: 'done', previous_status: 'owner_gate_review' })
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'system', `PR #${pr} rebase 후 자동 머지 성공.`, now, task.workspace_id)
      resolved++
      logger.info({ taskId: task.id, pr }, 'Conflict resolved via rebase, PR merged')
      continue
    } catch {
      // Rebase also failed
    }

    // Mark with cooldown timestamp to avoid retrying every cycle
    meta.conflict_resolution_attempted = now
    meta.conflict_resolution_attempted_at = now
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(serializeTaskMetadata(meta), now, task.id)
    failed++
    logger.warn({ taskId: task.id, pr }, 'Conflict resolution failed, will retry after cooldown')
  }

  return { resolved, failed, escalated }
}

// ---------------------------------------------------------------------------
// CAIO triage prompt
// ---------------------------------------------------------------------------

function buildTriagePrompt(tasks: AwaitingTask[]): string {
  const lines = [
    '## CAIO owner gate triage',
    '',
    '아래 태스크들이 owner queue로 가기 전에 CAIO 판단이 필요합니다.',
    '진짜 owner-only 작업이 아니면 owner queue로 보내지 마세요.',
    '',
    '### 가능한 조치',
    '- **redefine**: 태스크 범위/설명을 재정의하여 재할당. 구체적 파일 경로, 함수명, 구현 단계를 newDescription에 명시.',
    '- **reassign**: 다른 에이전트에게 재할당.',
    '- **recover**: 복구 플랜과 함께 실행 큐로 되돌림.',
    '- **request_approval**: 간단한 승인/권한 요청만 필요. blocked_approval로 이동.',
    '- **escalate_owner**: API key/token/secret/login/billing 등 진짜 owner-only일 때만 사용.',
    '- **cancel**: 중복이거나 불필요한 태스크를 취소.',
    '',
    '### 태스크 목록',
    '',
  ]

  for (const task of tasks) {
    const meta = parseTaskMetadata(task.metadata)
    lines.push(
      `#### Task ID: ${task.id} — ${task.title}`,
      `- **taskId**: ${task.id}`,
      `- **담당**: ${task.assigned_to || 'N/A'}`,
      `- **실패 사유**: ${task.error_message || meta.awaiting_reason || 'N/A'}`,
      `- **dispatch 시도**: ${meta.dispatch_attempts || 0}회`,
    )
    if (task.description) {
      lines.push(`- **설명**: ${task.description.substring(0, 300)}`)
    }
    lines.push('')
  }

  lines.push(
    '### RESPONSE FORMAT',
    '',
    'JSON array ONLY. No markdown, no explanations.',
    'Each: { "taskId": number, "action": "redefine"|"reassign"|"recover"|"request_approval"|"escalate_owner"|"cancel", "targetAgent": "FE"|"BE"|..., "reason": "...", "newTitle": "...", "newDescription": "..." }',
    '',
    'Valid agents: FE, BE, CTO, Data, Designer, DevOps, QA, Security, Automation, Trader',
    '',
    'Rules:',
    '- API key/token/secret/login/billing only => escalate_owner.',
    '- "no code changes" failures: MUST use "redefine" with concrete newDescription (file paths, function names, implementation steps).',
    '- Repeatedly failed tasks: analyze root cause. Narrow scope in newDescription.',
    '- Duplicate/meaningless: cancel.',
    '- Respond for ALL tasks.',
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Parse CAIO response
// ---------------------------------------------------------------------------

function parseTriageResponse(text: string, taskIds: Set<number>): TriageDecision[] {
  const decisions: TriageDecision[] = []

  // Try to extract JSON array
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  const candidate = jsonMatch?.[0] || text

  try {
    const parsed = JSON.parse(candidate)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of arr) {
      if (!item?.taskId || !item?.action) continue
      if (!taskIds.has(item.taskId)) continue
      const action = String(item.action).toLowerCase() as TriageAction
      if (!['reassign', 'redefine', 'recover', 'request_approval', 'escalate_owner', 'cancel'].includes(action)) continue
      decisions.push({
        taskId: item.taskId,
        action,
        targetAgent: item.targetAgent || undefined,
        newTitle: item.newTitle || undefined,
        newDescription: item.newDescription || undefined,
        reason: String(item.reason || '').substring(0, 500),
      })
    }
  } catch {
    // Fallback: regex extraction
    const taskIdMatches = text.matchAll(/"taskId"\s*:\s*(\d+)/g)
    for (const m of taskIdMatches) {
      const tid = parseInt(m[1], 10)
      if (!taskIds.has(tid)) continue
      const region = text.substring(Math.max(0, m.index! - 50), Math.min(text.length, m.index! + 500))
      const actionMatch = region.match(/"action"\s*:\s*"(reassign|redefine|recover|request_approval|escalate_owner|cancel)"/)
      const targetMatch = region.match(/"targetAgent"\s*:\s*"([^"]*)"/)
      const reasonMatch = region.match(/"reason"\s*:\s*"([^"]*)"/)
      if (actionMatch) {
        decisions.push({
          taskId: tid,
          action: actionMatch[1] as TriageAction,
          targetAgent: targetMatch?.[1] || undefined,
          reason: reasonMatch?.[1]?.substring(0, 500) || 'CAIO triage',
        })
      }
    }
  }

  return decisions
}

function extractGatewayResponseText(payload: unknown, raw: string): string {
  const candidate = payload as Record<string, unknown> | null
  if (candidate) {
    const result = (candidate.result ?? candidate) as { [key: string]: any }
    if (typeof result.text === 'string') return result.text
    if (typeof result.response === 'string') return result.response
    if (typeof result.output === 'string') return result.output
    const payloadText = (result.payloads?.[0] as { text?: unknown })?.text
    return typeof payloadText === 'string' ? payloadText : ''
  }
  return String(raw || '').trim()
}

async function callAdminTriager(prompt: string): Promise<string> {
  const invokeParams = {
    message: prompt,
    agentId: 'admin',
    idempotencyKey: `owner-gate-${Date.now()}`,
    deliver: false,
  }

  const finalResult = await runOpenClaw([
    'gateway',
    'call',
    'agent',
    '--expect-final',
    '--timeout',
    String(CAIO_TIMEOUT_MS),
    '--params',
    JSON.stringify(invokeParams),
    '--json',
  ], { timeoutMs: CAIO_TIMEOUT_MS + 5_000 })

  const payload = parseGatewayJsonOutput(finalResult.stdout)
    || parseGatewayJsonOutput(String((finalResult as any)?.stderr || ''))

  return extractGatewayResponseText(payload, finalResult.stdout)
}

// ---------------------------------------------------------------------------
// Apply CAIO decisions
// ---------------------------------------------------------------------------

function applyDecisions(
  db: ReturnType<typeof getDatabase>,
  decisions: TriageDecision[],
  taskMap: Map<number, AwaitingTask>,
): { reassigned: number; redefined: number; approvals: number; ownerEscalated: number; cancelled: number } {
  const policy = getOwnerQueuePolicy(db)
  let reassigned = 0
  let redefined = 0
  let approvals = 0
  let ownerEscalated = 0
  let cancelled = 0
  const now = Math.floor(Date.now() / 1000)

  for (const d of decisions) {
    const task = taskMap.get(d.taskId)
    if (!task) continue

    const meta = parseTaskMetadata(task.metadata)
    meta.caio_triage_at = now
    meta.caio_triage_action = d.action
    meta.caio_triage_reason = d.reason
    const reassignAction = ['reassign', 'redefine', 'recover'].includes(d.action)
    meta.caio_reassign_count = Number(meta.caio_reassign_count || 0) + 1

    if (reassignAction && Number(meta.caio_reassign_count) >= OWNER_GATE_RETRY_LIMIT) {
      const escalateReason = `CAIO owner-gate triage retried ${meta.caio_reassign_count} times without resolution. Manual owner review required.`
      markNeedsOwnerTransition(meta, 'auto_guard', escalateReason)
      db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, error_message = ?, updated_at = ? WHERE id = ?')
        .run('needs_owner', 'owner', serializeTaskMetadata(meta), escalateReason, now, task.id)
      eventBus.broadcast('task.status_changed', { id: task.id, status: 'needs_owner', previous_status: 'owner_gate_review' })
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id)')
        .run(task.id, 'CAIO', `CAIO owner gate retry limit exceeded (${OWNER_GATE_RETRY_LIMIT}). 수동 owner review가 필요합니다.\n사유: ${d.reason}`, now, task.workspace_id)
      sendOwnerQueueNotification(
        db,
        policy,
        task,
        'owner_gate_review',
        'needs_owner',
        escalateReason,
      )
      ownerEscalated++
      logger.info({ taskId: task.id, action: d.action, caioReassignCount: meta.caio_reassign_count }, 'CAIO owner-gate escalation due to retry limit')
      continue
    }

    switch (d.action) {
      case 'reassign':
      case 'redefine':
      case 'recover': {
        const target = d.targetAgent || task.assigned_to || 'CTO'
        const updates: string[] = ['status = ?', 'assigned_to = ?', 'metadata = ?', 'error_message = NULL', 'dispatch_attempts = 0', 'updated_at = ?']
        const nextStatus = d.action === 'recover' ? 'recovering' : 'assigned'
        meta.harness = {
          ...(meta.harness || {}),
          step: nextStatus,
        }
        const values: any[] = [nextStatus, target, serializeTaskMetadata(meta), now]

        if (d.newTitle) { updates.push('title = ?'); values.push(d.newTitle) }
        if (d.newDescription) { updates.push('description = ?'); values.push(d.newDescription) }

        values.push(task.id)
        db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values)

        eventBus.broadcast('task.status_changed', { id: task.id, status: nextStatus, previous_status: 'owner_gate_review' })

        const commentParts = [`CAIO owner gate → ${d.action}: ${target}`, `사유: ${d.reason}`]
        if (d.newTitle) commentParts.push(`새 제목: ${d.newTitle}`)
        if (d.newDescription) commentParts.push(`새 설명: ${d.newDescription.substring(0, 300)}`)
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', commentParts.join('\n'), now, task.workspace_id)

        if (d.action === 'redefine') redefined++; else reassigned++
        break
      }

      case 'request_approval': {
        meta.harness = {
          ...(meta.harness || {}),
          step: 'blocked_approval',
        }
        db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
          .run('blocked_approval', serializeTaskMetadata(meta), now, task.id)
        eventBus.broadcast('task.status_changed', { id: task.id, status: 'blocked_approval', previous_status: 'owner_gate_review' })
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', `CAIO owner gate → blocked_approval\n사유: ${d.reason}`, now, task.workspace_id)
        approvals++
        break
      }

      case 'escalate_owner': {
        markNeedsOwnerTransition(meta, 'owner_only', d.reason)
        db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?')
          .run('needs_owner', 'owner', serializeTaskMetadata(meta), now, task.id)
        eventBus.broadcast('task.status_changed', { id: task.id, status: 'needs_owner', previous_status: 'owner_gate_review' })
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', `CAIO owner gate → needs_owner\n사유: ${d.reason}`, now, task.workspace_id)
        sendOwnerQueueNotification(
          db,
          policy,
          task,
          'owner_gate_review',
          'needs_owner',
          d.reason,
        )
        ownerEscalated++
        break
      }

      case 'cancel': {
        db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
          .run('cancelled', serializeTaskMetadata(meta), now, task.id)
        eventBus.broadcast('task.status_changed', { id: task.id, status: 'cancelled', previous_status: 'owner_gate_review' })
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', `CAIO 트리아지 → 취소\n사유: ${d.reason}`, now, task.workspace_id)
        cancelled++
        break
      }
    }

    logger.info({ taskId: task.id, action: d.action, target: d.targetAgent }, 'CAIO triage decision applied')
  }

  return { reassigned, redefined, approvals, ownerEscalated, cancelled }
}

// ---------------------------------------------------------------------------
// Fallback: simple auto-reassign
// ---------------------------------------------------------------------------

function doFallbackReassign(db: ReturnType<typeof getDatabase>, tasks: AwaitingTask[]): void {
  const now = Math.floor(Date.now() / 1000)
  const TITLE_PREFIX_RE = /^\[([A-Za-z]+)\]/
  const policy = getOwnerQueuePolicy(db)

  for (const task of tasks) {
    const meta = parseTaskMetadata(task.metadata)
    const fallbackCount = Number(meta.caio_reassign_count || 0) + 1
    meta.caio_reassign_count = fallbackCount
    const prefixMatch = task.title.match(TITLE_PREFIX_RE)
    const target = prefixMatch?.[1] || task.assigned_to || 'CTO'

    if (fallbackCount >= FALLBACK_REASSIGN_LIMIT) {
      const escalateReason = `Owner-gate fallback reassign repeated ${fallbackCount} times without resolution. Manual owner review required.`
      markNeedsOwnerTransition(meta, 'auto_guard', escalateReason)
      db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, error_message = ?, metadata = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?')
        .run('needs_owner', 'owner', escalateReason, serializeTaskMetadata(meta), task.dispatch_attempts ?? 0, now, task.id)
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'needs_owner',
        previous_status: 'owner_gate_review',
        error_message: 'owner_gate_fallback_limit_exceeded',
        reason: 'owner_gate_fallback_limit',
      })
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'system', `Owner-gate fallback limit 초과로 수동 owner 검토 대상 전환됨 (${fallbackCount}회).`, now, task.workspace_id)
      sendOwnerQueueNotification(
        db,
        policy,
        task,
        'owner_gate_review',
        'needs_owner',
        escalateReason,
      )
      logger.info({ taskId: task.id, fallbackCount }, 'Owner-gate fallback reassign exceeded, moved to needs_owner')
      continue
    }

    meta.harness = {
      ...(meta.harness || {}),
      step: 'assigned',
    }

    db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, error_message = NULL, dispatch_attempts = 0, updated_at = ? WHERE id = ?')
      .run('assigned', target, serializeTaskMetadata(meta), now, task.id)

    eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'owner_gate_review' })

    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.id, 'system', `Auto-reassign (fallback): owner_gate_review → assigned (${target})`, now, task.workspace_id)
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function reassignAwaitingOwnerTasks(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const policy = getOwnerQueuePolicy(db)
    const parts: string[] = []
    const escalatedFromOwnerGate = escalateStaleOwnerGateTasks(db, policy, now)
    if (escalatedFromOwnerGate > 0) {
      parts.push(`${escalatedFromOwnerGate} owner_gate_review task(s) auto-escalated to needs_owner after stale timeout`)
    }

    const prunedCount = pruneTransientNeedsOwnerTasks(db, policy, now)
    if (prunedCount > 0) {
      parts.push(`${prunedCount} stale needs_owner task(s) auto-failed by TTL`)
    }

    const tasks = db.prepare(`
      SELECT t.id, t.title, t.description, t.metadata, t.assigned_to, t.workspace_id,
             t.error_message, t.github_pr_state, t.github_pr_number, t.github_branch, t.dispatch_attempts,
             p.github_repo, p.github_default_branch
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.status IN ('owner_gate_review', 'awaiting_owner')
      ORDER BY t.updated_at ASC
      LIMIT ?
    `).all(TRIAGE_BATCH_SIZE) as AwaitingTask[]

    if (tasks.length === 0) {
      return { ok: true, message: parts.length > 0 ? parts.join(' | ') : 'No owner-gate tasks to triage' }
    }

    // Categorize
    const ownerOnly: AwaitingTask[] = []
    const conflicts: AwaitingTask[] = []
    const triageable: AwaitingTask[] = []

    for (const task of tasks) {
      if (isOwnerOnlyTask(task.title, task.description)) {
        ownerOnly.push(task)
      } else if (task.github_pr_state === 'conflict') {
        const meta = parseTaskMetadata(task.metadata)
        const lastAttempt = Number(meta.conflict_resolution_attempted || 0)
        const now = Math.floor(Date.now() / 1000)
        if (now - lastAttempt > 1800) { // 30 min cooldown
          conflicts.push(task)
        }
      } else {
        triageable.push(task)
      }
    }

    // 1. Owner-only
    if (ownerOnly.length > 0) {
      const count = handleOwnerOnlyTasks(db, ownerOnly)
      parts.push(`${count} owner-assigned`)
    }

    // 2. Merge conflicts
    if (conflicts.length > 0) {
      const result = await handleConflictTasks(db, conflicts, policy)
      if (result.resolved > 0) parts.push(`${result.resolved} conflicts resolved`)
      if (result.failed > 0) parts.push(`${result.failed} conflicts pending`)
      if (result.escalated > 0) parts.push(`${result.escalated} conflicts escalated to needs_owner`)
    }

    // 3. CAIO triage
    if (triageable.length > 0) {
      try {
        const prompt = buildTriagePrompt(triageable)
        const taskIds = new Set(triageable.map(t => t.id))
        const taskMap = new Map(triageable.map(t => [t.id, t]))

        logger.info({ count: triageable.length }, 'Sending owner gate tasks to CAIO for triage')

        const responseText = await callAdminTriager(prompt)

        if (responseText) {
          const decisions = parseTriageResponse(responseText, taskIds)
          if (decisions.length > 0) {
            const result = applyDecisions(db, decisions, taskMap)
            const decidedIds = new Set(decisions.map(d => d.taskId))
            const undecided = triageable.filter(t => !decidedIds.has(t.id))
            if (undecided.length > 0) doFallbackReassign(db, undecided)
            parts.push(`CAIO: ${result.reassigned} reassigned, ${result.redefined} redefined, ${result.approvals} approvals, ${result.ownerEscalated} owner escalated, ${result.cancelled} cancelled`)
          } else {
            doFallbackReassign(db, triageable)
            parts.push(`${triageable.length} fallback-reassigned (no CAIO decisions)`)
          }
        } else {
          doFallbackReassign(db, triageable)
          parts.push(`${triageable.length} fallback-reassigned (empty response)`)
        }
      } catch (err: any) {
        logger.warn({ err }, 'CAIO triage failed, falling back to auto-reassign')
        doFallbackReassign(db, triageable)
        parts.push(`${triageable.length} fallback-reassigned (CAIO error)`)
      }
    }

    return { ok: true, message: parts.length > 0 ? parts.join(' | ') : 'No actionable tasks' }
  } catch (err: any) {
    logger.error({ err }, 'Owner gate triage failed')
    return { ok: false, message: `Triage failed: ${err.message}` }
  }
}
