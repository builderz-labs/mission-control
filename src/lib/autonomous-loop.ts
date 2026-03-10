import fs from 'node:fs'
import path from 'node:path'
import { getDatabase, db_helpers, logAuditEvent } from '@/lib/db'
import { mergeTaskProgressMetadata } from '@/lib/task-progress'
import { findWorkspaceRootFromPath } from '@/lib/task-verification'

export interface AutonomousLoopSettings {
  enabled: boolean
  autoSpawnEnabled: boolean
  debateEnabled: boolean
  selfHealEnabled: boolean
  maxAutoSpawnWorkers: number
  maxAutoSpawnReviewers: number
  maxTaskAttemptsBeforeDebate: number
}

export interface AutonomousLoopResult {
  spawnedAgents: number
  debatedTasks: number
  healedRepos: number
  healActions: number
  message: string
}

type TaskRow = {
  id: number
  title: string
  status: string
  assigned_to: string | null
  metadata: string | null
  created_at: number
  updated_at: number
  estimated_hours: number | null
  actual_hours: number | null
}

type AgentCountRow = {
  count: number
}

export type OrchestratorRecoveryStrategy = 'retry_same_agent' | 'reroute_agent'
export type OrchestratorThirtyMinuteReviewKind = 'problem' | 'wait' | 'bug_restart'

const THIRTY_MINUTES_SECONDS = 30 * 60
const ORCHESTRATOR_REVIEW_COOLDOWN_SECONDS = 10 * 60

type OrchestratorRecoveryDecision = {
  strategy: OrchestratorRecoveryStrategy
  summary: string
  instructions: string
  preferredAgent?: string
  avoidAgent?: string
}

type ThirtyMinuteTaskReview = {
  kind: OrchestratorThirtyMinuteReviewKind
  summary: string
  waitMinutes?: number
  shouldRestart: boolean
}

function readBooleanSetting(key: string, fallback: boolean) {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    if (!row?.value) return fallback
    return row.value === 'true'
  } catch {
    return fallback
  }
}

function readNumberSetting(key: string, fallback: number) {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    const value = Number(row?.value)
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

export function getAutonomousLoopSettings(): AutonomousLoopSettings {
  return {
    enabled: readBooleanSetting('general.autonomous_dev_loop', true),
    autoSpawnEnabled: readBooleanSetting('orchestrator.auto_spawn_agents', true),
    debateEnabled: readBooleanSetting('orchestrator.agent_debate_enabled', true),
    selfHealEnabled: readBooleanSetting('orchestrator.repo_self_heal', true),
    maxAutoSpawnWorkers: readNumberSetting('orchestrator.max_auto_spawn_workers', 2),
    maxAutoSpawnReviewers: readNumberSetting('orchestrator.max_auto_spawn_reviewers', 1),
    maxTaskAttemptsBeforeDebate: readNumberSetting('orchestrator.max_task_attempts_before_debate', 2),
  }
}

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getTaskStartedAt(task: TaskRow, metadata: Record<string, any>) {
  const explicitStartedAt = Number(metadata.started_at || metadata.stage_started_at)
  if (Number.isFinite(explicitStartedAt) && explicitStartedAt > 0) return explicitStartedAt
  return task.created_at
}

function toLowerText(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function normalizeBlockerReason(reason?: string) {
  return (reason || 'The previous run did not provide enough verified evidence to complete the task.').trim()
}

function getProblemFixAndPrevention(reason?: string) {
  const blocker = normalizeBlockerReason(reason)
  const lower = blocker.toLowerCase()

  if (/\bconfig|environment|env\b|\bpermission|auth|token|credential\b|\bmigration|schema|database\b/.test(lower)) {
    return {
      fix: 'repair the missing environment or configuration prerequisite before re-running the task',
      prevent: 'run a prerequisite checklist for config, auth, and migrations before assigning the task',
    }
  }

  if (/\bno changed files\b|\bno verified diff\b|\bverification\b|\bnothing changed\b/.test(lower)) {
    return {
      fix: 'retry with a tighter file scope and require a verified diff before handing the task forward',
      prevent: 'capture the intended file list up front and run verification before moving to review',
    }
  }

  if (/\btimeout\b|\bstuck\b|\bslow\b|\blong running\b/.test(lower)) {
    return {
      fix: 'break the work into a smaller retry so the next run can finish within the monitoring window',
      prevent: 'split large tasks into smaller milestones and add intermediate checkpoints before long execution windows',
    }
  }

  return {
    fix: 'address the blocker directly before sending the next retry',
    prevent: 'record the blocker in the task brief and validate the prerequisite before dispatch',
  }
}

export function decideOrchestratorRecovery(params: {
  title: string
  status: string
  failureCount: number
  blocker?: string
  lastAgent?: string
  lastExitCode?: number | null
}) : OrchestratorRecoveryDecision {
  const blocker = normalizeBlockerReason(params.blocker)
  const strategy: OrchestratorRecoveryStrategy = (
    (typeof params.lastExitCode === 'number' && params.lastExitCode !== 0)
    || params.failureCount >= 2
    || params.status === 'review'
    || params.status === 'quality_review'
  )
    ? 'reroute_agent'
    : 'retry_same_agent'

  if (strategy === 'retry_same_agent') {
    return {
      strategy,
      preferredAgent: params.lastAgent,
      summary: `Orchestrator decision: retry ${params.lastAgent || 'the same agent'} with a new approach.`,
      instructions: [
        `Previous blocker: ${blocker}`,
        'Retry the same task with a smaller context slice and a different implementation plan.',
        'State the new plan before editing and do not repeat the previous failed approach.',
      ].join(' '),
    }
  }

  return {
    strategy,
    avoidAgent: params.lastAgent,
    summary: `Orchestrator decision: reroute to another agent instead of repeating ${params.lastAgent || 'the last agent'}.`,
    instructions: [
      `Previous blocker: ${blocker}`,
      'A different agent must take over and verify assumptions from scratch.',
      'Use a new approach, not a copy of the previous attempt.',
    ].join(' '),
  }
}

export function buildThirtyMinuteTaskReview(params: {
  status: string
  elapsedSeconds: number
  blocker?: string
  failureCount: number
  lastExitCode?: number | null
}) : ThirtyMinuteTaskReview {
  const blocker = normalizeBlockerReason(params.blocker)
  const lower = blocker.toLowerCase()

  if (
    (typeof params.lastExitCode === 'number' && params.lastExitCode !== 0)
    || params.failureCount >= 3
    || /\bbug\b|\bcrash\b|\bexception\b|\btraceback\b|\bfailed to start\b|\bsegfault\b/.test(lower)
  ) {
    return {
      kind: 'bug_restart',
      summary: '3. it bug. it will be restart.',
      shouldRestart: true,
    }
  }

  if (params.failureCount === 0 && (params.status === 'review' || params.status === 'quality_review')) {
    const waitMinutes = params.status === 'quality_review' ? 10 : 15
    return {
      kind: 'wait',
      summary: `2. it is just a normal activity just wait for "${waitMinutes}" minute`,
      waitMinutes,
      shouldRestart: false,
    }
  }

  if (params.failureCount === 0 && params.elapsedSeconds < 45 * 60) {
    const waitMinutes = 15
    return {
      kind: 'wait',
      summary: `2. it is just a normal activity just wait for "${waitMinutes}" minute`,
      waitMinutes,
      shouldRestart: false,
    }
  }

  const { fix, prevent } = getProblemFixAndPrevention(blocker)
  return {
    kind: 'problem',
    summary: `1. it is a problem with "${blocker}" how to fixed and prevent. Fix: ${fix}. Prevent: ${prevent}.`,
    shouldRestart: false,
  }
}

function getRecoveryRetryStatus(status: string) {
  return status === 'review' || status === 'quality_review' ? status : 'inbox'
}

function getQueueBacklog() {
  const db = getDatabase()
  const inbox = (db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'inbox'`).get() as AgentCountRow | undefined)?.count || 0
  const review = (db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'review'`).get() as AgentCountRow | undefined)?.count || 0
  const qualityReview = (db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'quality_review'`).get() as AgentCountRow | undefined)?.count || 0
  return { inbox, review, qualityReview }
}

function countLaneAgents(lane: 'worker' | 'reviewer') {
  const db = getDatabase()
  const where = lane === 'reviewer'
    ? `(LOWER(COALESCE(role, '')) LIKE '%review%')`
    : `(LOWER(COALESCE(role, '')) NOT LIKE '%review%')`

  const active = (db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE status IN ('idle', 'busy') AND ${where}`
  ).get() as AgentCountRow | undefined)?.count || 0

  const autoSpawned = (db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE config LIKE ? AND ${where}`
  ).get('%"auto_spawned":true%') as AgentCountRow | undefined)?.count || 0

  return { active, autoSpawned }
}

export function planAutoSpawnForBacklog(params: {
  backlog: number
  activeAgents: number
  autoSpawnedAgents: number
  maxAutoSpawnAgents: number
  tasksPerAgent: number
}) {
  const desiredAgents = Math.max(0, Math.ceil(params.backlog / Math.max(1, params.tasksPerAgent)))
  const needed = Math.max(0, desiredAgents - params.activeAgents)
  const remainingCapacity = Math.max(0, params.maxAutoSpawnAgents - params.autoSpawnedAgents)
  return Math.min(needed, remainingCapacity)
}

function nextAutoAgentName(prefix: string) {
  const db = getDatabase()
  const rows = db.prepare(`SELECT name FROM agents WHERE name LIKE ? ORDER BY name ASC`).all(`${prefix}%`) as Array<{ name: string }>
  const taken = new Set(
    rows
      .map((row) => {
        const match = row.name.match(/(\d+)$/)
        return match ? Number(match[1]) : undefined
      })
      .filter((value): value is number => typeof value === 'number')
  )
  let index = 1
  while (taken.has(index)) index += 1
  return `${prefix}${index}`
}

export function runAutoSpawnAgents(now = Math.floor(Date.now() / 1000), settings = getAutonomousLoopSettings()) {
  if (!settings.enabled || !settings.autoSpawnEnabled) {
    return { created: 0, createdWorkers: 0, createdReviewers: 0 }
  }

  const db = getDatabase()
  const backlog = getQueueBacklog()
  const workerCounts = countLaneAgents('worker')
  const reviewerCounts = countLaneAgents('reviewer')

  const workersToCreate = planAutoSpawnForBacklog({
    backlog: backlog.inbox,
    activeAgents: workerCounts.active,
    autoSpawnedAgents: workerCounts.autoSpawned,
    maxAutoSpawnAgents: settings.maxAutoSpawnWorkers,
    tasksPerAgent: 2,
  })
  const reviewersToCreate = planAutoSpawnForBacklog({
    backlog: backlog.review + backlog.qualityReview,
    activeAgents: reviewerCounts.active,
    autoSpawnedAgents: reviewerCounts.autoSpawned,
    maxAutoSpawnAgents: settings.maxAutoSpawnReviewers,
    tasksPerAgent: 2,
  })

  if (workersToCreate === 0 && reviewersToCreate === 0) {
    return { created: 0, createdWorkers: 0, createdReviewers: 0 }
  }

  const insert = db.prepare(`
    INSERT INTO agents (name, role, status, created_at, updated_at, config)
    VALUES (?, ?, 'idle', ?, ?, ?)
  `)

  let createdWorkers = 0
  let createdReviewers = 0

  db.transaction(() => {
    for (let i = 0; i < workersToCreate; i++) {
      const name = nextAutoAgentName('AutoWorker')
      insert.run(name, 'autonomous_worker', now, now, JSON.stringify({
        team: 'orchestrator',
        auto_spawned: true,
        lane: 'worker',
        model: 'llama3-8b-8192',
        specialties: ['autonomous', 'low-token', 'implementation'],
      }))
      createdWorkers += 1
      db_helpers.logActivity('agent_spawned', 'agent', 0, 'autonomous-loop', `Spawned ${name} for inbox backlog`, { lane: 'worker' })
    }

    for (let i = 0; i < reviewersToCreate; i++) {
      const name = nextAutoAgentName('AutoReviewer')
      insert.run(name, 'autonomous_reviewer', now, now, JSON.stringify({
        team: 'orchestrator',
        auto_spawned: true,
        lane: 'reviewer',
        model: 'llama3-8b-8192',
        specialties: ['autonomous', 'low-token', 'review'],
      }))
      createdReviewers += 1
      db_helpers.logActivity('agent_spawned', 'agent', 0, 'autonomous-loop', `Spawned ${name} for review backlog`, { lane: 'reviewer' })
    }
  })()

  if (createdWorkers + createdReviewers > 0) {
    logAuditEvent({
      action: 'autonomous_auto_spawn',
      actor: 'autonomous-loop',
      detail: { workers: createdWorkers, reviewers: createdReviewers, backlog },
    })
  }

  return {
    created: createdWorkers + createdReviewers,
    createdWorkers,
    createdReviewers,
  }
}

export function buildDebateNote(params: {
  title: string
  status: string
  blocker?: string
  reason?: string
  round: number
}) {
  const blocker = params.blocker || params.reason || 'Verification did not provide enough evidence to pass this stage.'
  const stageLabel = params.status.replace(/_/g, ' ')
  return [
    `## Agent Debate Round ${params.round}`,
    ``,
    `Implementer: The task "${params.title}" attempted to clear ${stageLabel}.`,
    `Reviewer: ${blocker}`,
    `Judge: Return the task to patch planning with one concrete next step and avoid another full-context retry.`,
    `Token policy: Use the smallest viable context slice and only reopen the exact files mentioned by the blocker.`,
  ].join('\n')
}

export function runAgentDebateSystem(now = Math.floor(Date.now() / 1000), settings = getAutonomousLoopSettings()) {
  if (!settings.enabled || !settings.debateEnabled) {
    return { debated: 0 }
  }

  const db = getDatabase()
  const tasks = db.prepare(`
    SELECT id, title, status, assigned_to, metadata, created_at, updated_at, estimated_hours, actual_hours
    FROM tasks
    WHERE status IN ('inbox', 'review', 'quality_review')
    ORDER BY updated_at DESC
    LIMIT 40
  `).all() as TaskRow[]

  const updateTask = db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
  const insertComment = db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'debate-system', ?, ?)`)
  const insertActivity = db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description, data) VALUES ('agent_debate', 'task', ?, 'debate-system', ?, ?)`)

  let debated = 0

  db.transaction(() => {
    for (const task of tasks) {
      const metadata = parseMetadata(task.metadata)
      const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object' ? metadata.autonomous : {}
      const verification = metadata.verification && typeof metadata.verification === 'object' ? metadata.verification : {}
      const failureCount = Number(autonomous.failure_count || 0)
      const debateRounds = Number(autonomous.debate_rounds || 0)
      const lastDebateAt = Number(autonomous.last_debate_at || 0)
      const lastOrchestratorDecisionAt = Number(autonomous.last_orchestrator_decision_at || 0)
      const blocker = typeof verification.reason === 'string' ? verification.reason : undefined

      const needsDebate = (
        (failureCount >= settings.maxTaskAttemptsBeforeDebate || task.status === 'quality_review' || task.status === 'review')
        && verification.passed === false
        && debateRounds < 3
        && (lastDebateAt === 0 || (now - lastDebateAt) > 300)
        && (lastOrchestratorDecisionAt === 0 || (now - lastOrchestratorDecisionAt) > 300)
      )

      if (!needsDebate) continue

      const round = debateRounds + 1
      const debateNote = buildDebateNote({
        title: task.title,
        status: task.status,
        blocker,
        reason: blocker,
        round,
      })

      const nextMetadata = mergeTaskProgressMetadata({
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at,
        estimated_hours: task.estimated_hours ?? undefined,
        actual_hours: task.actual_hours ?? undefined,
        metadata,
      }, 'inbox', now, {
        ...metadata,
        autonomous: {
          ...autonomous,
          debate_rounds: round,
          last_debate_at: now,
          debate_pending: false,
          last_debate_summary: blocker || 'Debate requested a targeted patch retry.',
        },
      })

      updateTask.run('inbox', null, JSON.stringify(nextMetadata), now, task.id)
      insertComment.run(task.id, debateNote, now)
      insertActivity.run(task.id, `Debated task "${task.title}" and returned it to inbox for a tighter retry`, JSON.stringify({
        round,
        blocker,
      }))
      debated += 1
    }
  })()

  if (debated > 0) {
    logAuditEvent({
      action: 'autonomous_agent_debate',
      actor: 'debate-system',
      detail: { debated_tasks: debated },
    })
  }

  return { debated }
}

export function runOrchestratorRecoveryLoop(now = Math.floor(Date.now() / 1000), settings = getAutonomousLoopSettings()) {
  if (!settings.enabled) {
    return { reviewed: 0, rerouted: 0, retried: 0 }
  }

  const db = getDatabase()
  const tasks = db.prepare(`
    SELECT id, title, status, assigned_to, metadata, created_at, updated_at, estimated_hours, actual_hours
    FROM tasks
    WHERE status IN ('inbox', 'in_progress', 'review', 'quality_review')
    ORDER BY updated_at DESC
    LIMIT 50
  `).all() as TaskRow[]

  const updateTask = db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
  const insertComment = db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
  const insertActivity = db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description, data) VALUES ('orchestrator_recovery', 'task', ?, 'orchestrator', ?, ?)`)

  let reviewed = 0
  let rerouted = 0
  let retried = 0

  db.transaction(() => {
    for (const task of tasks) {
      const metadata = parseMetadata(task.metadata)
      const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object' ? metadata.autonomous : {}
      const verification = metadata.verification && typeof metadata.verification === 'object' ? metadata.verification : {}
      const reportToOrchestrator = autonomous.report_to_orchestrator === true
      const failureCount = Number(autonomous.failure_count || 0)

      if (!reportToOrchestrator || failureCount <= 0) continue

      const blocker = typeof autonomous.last_failure_reason === 'string' && autonomous.last_failure_reason
        ? autonomous.last_failure_reason
        : typeof verification.reason === 'string'
        ? verification.reason
        : undefined

      const decision = decideOrchestratorRecovery({
        title: task.title,
        status: task.status,
        failureCount,
        blocker,
        lastAgent: typeof autonomous.last_failed_agent === 'string' ? autonomous.last_failed_agent : task.assigned_to || undefined,
        lastExitCode: Number.isFinite(Number(autonomous.last_exit_code)) ? Number(autonomous.last_exit_code) : undefined,
      })

      const nextStatus = getRecoveryRetryStatus(task.status)
      const nextMetadata = mergeTaskProgressMetadata({
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at,
        estimated_hours: task.estimated_hours ?? undefined,
        actual_hours: task.actual_hours ?? undefined,
        metadata,
      }, nextStatus, now, {
        ...metadata,
        autonomous: {
          ...autonomous,
          report_to_orchestrator: false,
          debate_pending: false,
          last_orchestrator_decision_at: now,
          recovery_plan: {
            strategy: decision.strategy,
            summary: decision.summary,
            instructions: decision.instructions,
            preferred_agent: decision.preferredAgent || null,
            avoid_agent: decision.avoidAgent || null,
            decided_at: now,
          },
        },
      })

      updateTask.run(nextStatus, null, JSON.stringify(nextMetadata), now, task.id)
      insertComment.run(task.id, `${decision.summary}\n\n${decision.instructions}`, now)
      insertActivity.run(task.id, decision.summary, JSON.stringify({
        strategy: decision.strategy,
        preferred_agent: decision.preferredAgent || null,
        avoid_agent: decision.avoidAgent || null,
      }))
      reviewed += 1
      if (decision.strategy === 'reroute_agent') rerouted += 1
      else retried += 1
    }
  })()

  if (reviewed > 0) {
    logAuditEvent({
      action: 'orchestrator_failure_recovery',
      actor: 'orchestrator',
      detail: { reviewed, rerouted, retried },
    })
  }

  return { reviewed, rerouted, retried }
}

export function runThirtyMinuteTaskReviews(now = Math.floor(Date.now() / 1000), settings = getAutonomousLoopSettings()) {
  if (!settings.enabled) {
    return { reviewed: 0, waiting: 0, problem: 0, restarted: 0 }
  }

  const db = getDatabase()
  const tasks = db.prepare(`
    SELECT id, title, status, assigned_to, metadata, created_at, updated_at, estimated_hours, actual_hours
    FROM tasks
    WHERE status IN ('inbox', 'assigned', 'in_progress', 'review', 'quality_review')
    ORDER BY updated_at DESC
    LIMIT 80
  `).all() as TaskRow[]

  const updateTask = db.prepare(`UPDATE tasks SET status = ?, assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
  const insertComment = db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator-review', ?, ?)`)
  const insertActivity = db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description, data) VALUES ('orchestrator_review', 'task', ?, 'orchestrator-review', ?, ?)`)

  let reviewed = 0
  let waiting = 0
  let problem = 0
  let restarted = 0

  db.transaction(() => {
    for (const task of tasks) {
      const metadata = parseMetadata(task.metadata)
      const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object' ? metadata.autonomous : {}
      const verification = metadata.verification && typeof metadata.verification === 'object' ? metadata.verification : {}
      const startedAt = getTaskStartedAt(task, metadata)
      const elapsedSeconds = now - startedAt
      if (elapsedSeconds < THIRTY_MINUTES_SECONDS) continue

      const blocker = typeof autonomous.last_failure_reason === 'string' && autonomous.last_failure_reason
        ? autonomous.last_failure_reason
        : typeof verification.reason === 'string'
        ? verification.reason
        : undefined
      const review = buildThirtyMinuteTaskReview({
        status: task.status,
        elapsedSeconds,
        blocker,
        failureCount: Number(autonomous.failure_count || 0),
        lastExitCode: Number.isFinite(Number(autonomous.last_exit_code)) ? Number(autonomous.last_exit_code) : undefined,
      })

      const existingReview = metadata.orchestrator_review_30m && typeof metadata.orchestrator_review_30m === 'object'
        ? metadata.orchestrator_review_30m
        : {}
      const previousKind = typeof existingReview.kind === 'string' ? existingReview.kind : ''
      const previousReviewedAt = Number(existingReview.reviewed_at || 0)
      const shouldWrite = previousKind !== review.kind || previousReviewedAt === 0 || (now - previousReviewedAt) >= ORCHESTRATOR_REVIEW_COOLDOWN_SECONDS
      if (!shouldWrite) continue

      const restartStatus = review.shouldRestart ? getRecoveryRetryStatus(task.status) : task.status
      const nextMetadata = mergeTaskProgressMetadata({
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at,
        estimated_hours: task.estimated_hours ?? undefined,
        actual_hours: task.actual_hours ?? undefined,
        metadata,
      }, restartStatus, now, {
        ...metadata,
        orchestrator_review_30m: {
          kind: review.kind,
          summary: review.summary,
          wait_minutes: review.waitMinutes || null,
          reviewed_at: now,
          elapsed_seconds: elapsedSeconds,
        },
        autonomous: {
          ...autonomous,
          report_to_orchestrator: review.shouldRestart ? true : autonomous.report_to_orchestrator === true,
          recovery_plan: review.shouldRestart ? null : autonomous.recovery_plan || null,
        },
      })

      updateTask.run(restartStatus, review.shouldRestart ? null : task.assigned_to, JSON.stringify(nextMetadata), now, task.id)
      insertComment.run(task.id, review.summary, now)
      insertActivity.run(task.id, `30-minute review for task "${task.title}"`, JSON.stringify({
        kind: review.kind,
        wait_minutes: review.waitMinutes || null,
        restarted: review.shouldRestart,
      }))
      reviewed += 1
      if (review.kind === 'wait') waiting += 1
      if (review.kind === 'problem') problem += 1
      if (review.kind === 'bug_restart') restarted += 1
    }
  })()

  if (reviewed > 0) {
    logAuditEvent({
      action: 'orchestrator_thirty_minute_review',
      actor: 'orchestrator-review',
      detail: { reviewed, waiting, problem, restarted },
    })
  }

  return { reviewed, waiting, problem, restarted }
}

function getTaskWorkspaceRoot(task: TaskRow) {
  const metadata = parseMetadata(task.metadata)
  if (typeof metadata.workspace_root === 'string' && metadata.workspace_root) return metadata.workspace_root
  if (typeof metadata.source_file === 'string' && metadata.source_file) {
    return findWorkspaceRootFromPath(metadata.source_file)
  }
  return null
}

export function runRepoSelfHeal(now = Math.floor(Date.now() / 1000), settings = getAutonomousLoopSettings()) {
  if (!settings.enabled || !settings.selfHealEnabled) {
    return { healedRepos: 0, actions: 0 }
  }

  const db = getDatabase()
  const tasks = db.prepare(`
    SELECT id, title, status, assigned_to, metadata, created_at, updated_at, estimated_hours, actual_hours
    FROM tasks
    WHERE status IN ('inbox', 'in_progress', 'review', 'quality_review')
    ORDER BY updated_at DESC
    LIMIT 30
  `).all() as TaskRow[]

  const workspaceToTask = new Map<string, TaskRow>()
  for (const task of tasks) {
    const root = getTaskWorkspaceRoot(task)
    if (root && !workspaceToTask.has(root)) workspaceToTask.set(root, task)
  }

  let healedRepos = 0
  let actions = 0

  for (const [workspaceRoot, task] of workspaceToTask.entries()) {
    const localActions: string[] = []

    const nextTypesDir = path.join(workspaceRoot, '.next', 'dev', 'types')
    if (fs.existsSync(nextTypesDir)) {
      try {
        fs.rmSync(nextTypesDir, { recursive: true, force: true })
        localActions.push('removed .next/dev/types')
      } catch {
        // ignore
      }
    }

    const tsBuildInfo = path.join(workspaceRoot, 'tsconfig.tsbuildinfo')
    if (fs.existsSync(tsBuildInfo)) {
      try {
        fs.rmSync(tsBuildInfo, { force: true })
        localActions.push('removed tsconfig.tsbuildinfo')
      } catch {
        // ignore
      }
    }

    if (localActions.length === 0) continue

    healedRepos += 1
    actions += localActions.length

    const metadata = parseMetadata(task.metadata)
    const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object' ? metadata.autonomous : {}
    const nextMetadata = mergeTaskProgressMetadata({
      status: task.status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      estimated_hours: task.estimated_hours ?? undefined,
      actual_hours: task.actual_hours ?? undefined,
      metadata,
    }, task.status, now, {
      ...metadata,
      autonomous: {
        ...autonomous,
        last_self_heal_at: now,
        self_heal_actions: Number(autonomous.self_heal_actions || 0) + localActions.length,
      },
    })

    db.prepare(`UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(nextMetadata), now, task.id)
    db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'self-heal', ?, ?)`)
      .run(task.id, `## Repo Self-Heal\n\nApplied safe local fixes in \`${workspaceRoot}\`:\n- ${localActions.join('\n- ')}\n\nToken policy: no model call was used.`, now)
    db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description, data) VALUES ('repo_self_heal', 'task', ?, 'self-heal', ?, ?)`)
      .run(task.id, `Self-healed workspace for task "${task.title}"`, JSON.stringify({ workspaceRoot, actions: localActions }))
  }

  if (actions > 0) {
    logAuditEvent({
      action: 'autonomous_repo_self_heal',
      actor: 'self-heal',
      detail: { healed_repos: healedRepos, actions },
    })
  }

  return { healedRepos, actions }
}
