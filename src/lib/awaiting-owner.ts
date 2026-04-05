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

import { getDatabase, db_helpers } from './db'
import { callOpenClawGateway } from './openclaw-gateway'
import { runCommand } from './command'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { config } from './config'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRIAGE_BATCH_SIZE = 15
const CAIO_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// Owner-only detection
// ---------------------------------------------------------------------------

const OWNER_ONLY_KEYWORDS = [
  'api key', 'api_key', 'apikey', 'oauth', 'secret', 'credential',
  'token 발급', '토큰 발급', '키 발급', '키 등록', '키 설정',
  'client_id', 'client_secret', 'service account', 'service_account',
  '인증 설정', '인증서', 'ssl cert', 'tls cert', '.env 설정', '외부 api',
]

function isOwnerOnlyTask(title: string, description: string | null): boolean {
  const text = `${title} ${description || ''}`.toLowerCase()
  return OWNER_ONLY_KEYWORDS.some(kw => text.includes(kw))
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
}

type TriageAction = 'reassign' | 'redefine' | 'cancel'

interface TriageDecision {
  taskId: number
  action: TriageAction
  targetAgent?: string
  newTitle?: string
  newDescription?: string
  reason: string
}

// ---------------------------------------------------------------------------
// Owner-only → assign to 'owner'
// ---------------------------------------------------------------------------

function handleOwnerOnlyTasks(db: ReturnType<typeof getDatabase>, tasks: AwaitingTask[]): number {
  const now = Math.floor(Date.now() / 1000)
  let count = 0
  for (const task of tasks) {
    db.prepare('UPDATE tasks SET assigned_to = ?, updated_at = ? WHERE id = ?')
      .run('owner', now, task.id)
    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.id, 'system', '이 태스크는 소유주의 직접 처리가 필요합니다 (API 키, 시크릿, 인증 설정 등).', now, task.workspace_id)
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
): Promise<{ resolved: number; failed: number }> {
  let resolved = 0
  let failed = 0
  const now = Math.floor(Date.now() / 1000)

  for (const task of tasks) {
    if (!task.github_pr_number || !task.github_repo) {
      failed++
      continue
    }

    const repo = task.github_repo
    const pr = task.github_pr_number

    // Attempt 1: direct merge (conflict may have been resolved by other merges)
    try {
      await runCommand('gh', [
        'pr', 'merge', String(pr), '--repo', repo, '--squash', '--delete-branch',
      ], { timeoutMs: 30_000 })

      db.prepare('UPDATE tasks SET status = ?, github_pr_state = ?, updated_at = ? WHERE id = ?')
        .run('done', 'merged', now, task.id)
      eventBus.broadcast('task.status_changed', { id: task.id, status: 'done', previous_status: 'awaiting_owner' })
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
      eventBus.broadcast('task.status_changed', { id: task.id, status: 'done', previous_status: 'awaiting_owner' })
      db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.id, 'system', `PR #${pr} rebase 후 자동 머지 성공.`, now, task.workspace_id)
      resolved++
      logger.info({ taskId: task.id, pr }, 'Conflict resolved via rebase, PR merged')
      continue
    } catch {
      // Rebase also failed
    }

    // Mark with cooldown timestamp to avoid retrying every cycle
    const meta = task.metadata ? JSON.parse(task.metadata) : {}
    meta.conflict_resolution_attempted = now
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(meta), now, task.id)
    failed++
    logger.warn({ taskId: task.id, pr }, 'Conflict resolution failed, will retry after cooldown')
  }

  return { resolved, failed }
}

// ---------------------------------------------------------------------------
// CAIO triage prompt
// ---------------------------------------------------------------------------

function buildTriagePrompt(tasks: AwaitingTask[]): string {
  const lines = [
    '## CAIO 트리아지: awaiting_owner 태스크 검토',
    '',
    '아래 태스크들이 반복 실패하여 자동 처리가 필요합니다.',
    '각 태스크의 실패 원인을 분석하고 조치를 결정해주세요.',
    '',
    '### 가능한 조치',
    '- **redefine**: 태스크 범위/설명을 재정의하여 재할당. 구체적 파일 경로, 함수명, 구현 단계를 newDescription에 명시.',
    '- **reassign**: 다른 에이전트에게 재할당.',
    '- **cancel**: 중복이거나 불필요한 태스크를 취소.',
    '',
    '### 태스크 목록',
    '',
  ]

  for (const task of tasks) {
    const meta = task.metadata ? JSON.parse(task.metadata) : {}
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
    'Each: { "taskId": number, "action": "redefine"|"reassign"|"cancel", "targetAgent": "FE"|"BE"|..., "reason": "...", "newTitle": "...", "newDescription": "..." }',
    '',
    'Valid agents: FE, BE, CTO, Data, Designer, DevOps, QA, Security, Automation, Trader',
    '',
    'Rules:',
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
      if (!['reassign', 'redefine', 'cancel'].includes(action)) continue
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
      const actionMatch = region.match(/"action"\s*:\s*"(reassign|redefine|cancel)"/)
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

// ---------------------------------------------------------------------------
// Apply CAIO decisions
// ---------------------------------------------------------------------------

function applyDecisions(
  db: ReturnType<typeof getDatabase>,
  decisions: TriageDecision[],
  taskMap: Map<number, AwaitingTask>,
): { reassigned: number; redefined: number; cancelled: number } {
  let reassigned = 0
  let redefined = 0
  let cancelled = 0
  const now = Math.floor(Date.now() / 1000)

  for (const d of decisions) {
    const task = taskMap.get(d.taskId)
    if (!task) continue

    const meta = task.metadata ? JSON.parse(task.metadata) : {}
    meta.caio_triage_at = now
    meta.caio_triage_action = d.action
    meta.caio_triage_reason = d.reason
    meta.caio_reassign_count = (meta.caio_reassign_count || 0) + 1

    switch (d.action) {
      case 'reassign':
      case 'redefine': {
        const target = d.targetAgent || task.assigned_to || 'CTO'
        const updates: string[] = ['status = ?', 'assigned_to = ?', 'metadata = ?', 'error_message = NULL', 'dispatch_attempts = 0', 'updated_at = ?']
        const values: any[] = ['assigned', target, JSON.stringify(meta), now]

        if (d.newTitle) { updates.push('title = ?'); values.push(d.newTitle) }
        if (d.newDescription) { updates.push('description = ?'); values.push(d.newDescription) }

        values.push(task.id)
        db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values)

        eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'awaiting_owner' })

        const commentParts = [`CAIO 트리아지 → ${d.action === 'redefine' ? '재정의' : '재할당'}: ${target}`, `사유: ${d.reason}`]
        if (d.newTitle) commentParts.push(`새 제목: ${d.newTitle}`)
        if (d.newDescription) commentParts.push(`새 설명: ${d.newDescription.substring(0, 300)}`)
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', commentParts.join('\n'), now, task.workspace_id)

        if (d.action === 'redefine') redefined++; else reassigned++
        break
      }

      case 'cancel': {
        db.prepare('UPDATE tasks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
          .run('cancelled', JSON.stringify(meta), now, task.id)
        eventBus.broadcast('task.status_changed', { id: task.id, status: 'cancelled', previous_status: 'awaiting_owner' })
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
          .run(task.id, 'CAIO', `CAIO 트리아지 → 취소\n사유: ${d.reason}`, now, task.workspace_id)
        cancelled++
        break
      }
    }

    logger.info({ taskId: task.id, action: d.action, target: d.targetAgent }, 'CAIO triage decision applied')
  }

  return { reassigned, redefined, cancelled }
}

// ---------------------------------------------------------------------------
// Fallback: simple auto-reassign
// ---------------------------------------------------------------------------

function doFallbackReassign(db: ReturnType<typeof getDatabase>, tasks: AwaitingTask[]): void {
  const now = Math.floor(Date.now() / 1000)
  const TITLE_PREFIX_RE = /^\[([A-Za-z]+)\]/

  for (const task of tasks) {
    const meta = task.metadata ? JSON.parse(task.metadata) : {}
    const prefixMatch = task.title.match(TITLE_PREFIX_RE)
    const target = prefixMatch?.[1] || task.assigned_to || 'CTO'

    meta.caio_reassign_count = (meta.caio_reassign_count || 0) + 1

    db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, error_message = NULL, dispatch_attempts = 0, updated_at = ? WHERE id = ?')
      .run('assigned', target, JSON.stringify(meta), now, task.id)

    eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'awaiting_owner' })

    db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.id, 'system', `Auto-reassign (fallback): awaiting_owner → assigned (${target})`, now, task.workspace_id)
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function reassignAwaitingOwnerTasks(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()

    const tasks = db.prepare(`
      SELECT t.id, t.title, t.description, t.metadata, t.assigned_to, t.workspace_id,
             t.error_message, t.github_pr_state, t.github_pr_number, t.github_branch,
             p.github_repo, p.github_default_branch
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.status = 'awaiting_owner'
        AND (t.assigned_to IS NULL OR t.assigned_to != 'owner')
      ORDER BY t.updated_at ASC
      LIMIT ?
    `).all(TRIAGE_BATCH_SIZE) as AwaitingTask[]

    if (tasks.length === 0) {
      return { ok: true, message: 'No awaiting_owner tasks to triage' }
    }

    // Categorize
    const ownerOnly: AwaitingTask[] = []
    const conflicts: AwaitingTask[] = []
    const triageable: AwaitingTask[] = []

    for (const task of tasks) {
      if (isOwnerOnlyTask(task.title, task.description)) {
        ownerOnly.push(task)
      } else if (task.github_pr_state === 'conflict') {
        const meta = task.metadata ? JSON.parse(task.metadata) : {}
        const lastAttempt = meta.conflict_resolution_attempted || 0
        const now = Math.floor(Date.now() / 1000)
        if (now - lastAttempt > 1800) { // 30 min cooldown
          conflicts.push(task)
        }
      } else {
        triageable.push(task)
      }
    }

    const parts: string[] = []

    // 1. Owner-only
    if (ownerOnly.length > 0) {
      const count = handleOwnerOnlyTasks(db, ownerOnly)
      parts.push(`${count} owner-assigned`)
    }

    // 2. Merge conflicts
    if (conflicts.length > 0) {
      const result = await handleConflictTasks(db, conflicts)
      if (result.resolved > 0) parts.push(`${result.resolved} conflicts resolved`)
      if (result.failed > 0) parts.push(`${result.failed} conflicts pending`)
    }

    // 3. CAIO triage
    if (triageable.length > 0) {
      try {
        const prompt = buildTriagePrompt(triageable)
        const taskIds = new Set(triageable.map(t => t.id))
        const taskMap = new Map(triageable.map(t => [t.id, t]))

        logger.info({ count: triageable.length }, 'Sending awaiting_owner tasks to CAIO for triage')

        const response = await callOpenClawGateway<{ text?: string; response?: string }>('agent.invoke', {
          agentId: 'admin',
          message: prompt,
        }, CAIO_TIMEOUT_MS)

        const responseText = response?.text || response?.response || ''

        if (responseText) {
          const decisions = parseTriageResponse(responseText, taskIds)
          if (decisions.length > 0) {
            const result = applyDecisions(db, decisions, taskMap)
            const decidedIds = new Set(decisions.map(d => d.taskId))
            const undecided = triageable.filter(t => !decidedIds.has(t.id))
            if (undecided.length > 0) doFallbackReassign(db, undecided)
            parts.push(`CAIO: ${result.reassigned} reassigned, ${result.redefined} redefined, ${result.cancelled} cancelled`)
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
    logger.error({ err }, 'Awaiting-owner triage failed')
    return { ok: false, message: `Triage failed: ${err.message}` }
  }
}
