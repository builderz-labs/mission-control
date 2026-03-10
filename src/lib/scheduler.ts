import { getDatabase, logAuditEvent } from './db'
import { syncAgentsFromConfig } from './agent-sync'
import { config, ensureDirExists } from './config'
import { join, dirname } from 'path'
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { logger } from './logger'
import { processWebhookRetries } from './webhooks'
import { syncClaudeSessions } from './claude-sessions'
import { spawnOrchestrator, spawnAgentTask } from './orchestrator-spawn'
import { isAgentAvailable } from './agent-availability'
import { mergeTaskProgressMetadata } from './task-progress'
import { findWorkspaceRootFromPath } from './task-verification'
import {
  getAutonomousLoopSettings,
  runAgentDebateSystem,
  runAutoSpawnAgents,
  runOrchestratorRecoveryLoop,
  runRepoSelfHeal,
  runThirtyMinuteTaskReviews,
} from './autonomous-loop'

const BACKUP_DIR = join(dirname(config.dbPath), 'backups')

interface ScheduledTask {
  name: string
  intervalMs: number
  lastRun: number | null
  nextRun: number
  enabled: boolean
  running: boolean
  lastResult?: { ok: boolean; message: string; timestamp: number }
}

const tasks: Map<string, ScheduledTask> = new Map()
let tickInterval: ReturnType<typeof setInterval> | null = null

/** Check if a setting is enabled (reads from settings table, falls back to default) */
function isSettingEnabled(key: string, defaultValue: boolean): boolean {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (row) return row.value === 'true'
    return defaultValue
  } catch {
    return defaultValue
  }
}

function getSettingNumber(key: string, defaultValue: number): number {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (row) return parseInt(row.value) || defaultValue
    return defaultValue
  } catch {
    return defaultValue
  }
}

/** Run a database backup */
async function runBackup(): Promise<{ ok: boolean; message: string }> {
  ensureDirExists(BACKUP_DIR)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const backupPath = join(BACKUP_DIR, `mc-backup-${timestamp}.db`)

  try {
    const db = getDatabase()
    await db.backup(backupPath)

    const stat = statSync(backupPath)
    logAuditEvent({
      action: 'auto_backup',
      actor: 'scheduler',
      detail: { path: backupPath, size: stat.size },
    })

    // Prune old backups
    const maxBackups = getSettingNumber('general.backup_retention_count', 10)
    try {
      const files = readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('mc-backup-') && f.endsWith('.db'))
        .map(f => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)

      for (const file of files.slice(maxBackups)) {
        unlinkSync(join(BACKUP_DIR, file.name))
      }
    } catch {
      // Best-effort pruning
    }

    const sizeKB = Math.round(stat.size / 1024)
    return { ok: true, message: `Backup created (${sizeKB}KB)` }
  } catch (err: any) {
    return { ok: false, message: `Backup failed: ${err.message}` }
  }
}

/** Run data cleanup based on retention settings */
async function runCleanup(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const ret = config.retention
    let totalDeleted = 0

    const targets = [
      { table: 'activities', column: 'created_at', days: ret.activities },
      { table: 'audit_log', column: 'created_at', days: ret.auditLog },
      { table: 'notifications', column: 'created_at', days: ret.notifications },
      { table: 'pipeline_runs', column: 'created_at', days: ret.pipelineRuns },
    ]

    for (const { table, column, days } of targets) {
      if (days <= 0) continue
      const cutoff = now - days * 86400
      try {
        const res = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoff)
        totalDeleted += res.changes
      } catch {
        // Table might not exist
      }
    }

    // Clean token usage file
    if (ret.tokenUsage > 0) {
      try {
        const { readFile, writeFile } = require('fs/promises')
        const raw = await readFile(config.tokensPath, 'utf-8')
        const data = JSON.parse(raw)
        const cutoffMs = Date.now() - ret.tokenUsage * 86400000
        const kept = data.filter((r: any) => r.timestamp >= cutoffMs)
        const removed = data.length - kept.length

        if (removed > 0) {
          await writeFile(config.tokensPath, JSON.stringify(kept, null, 2))
          totalDeleted += removed
        }
      } catch {
        // No token file
      }
    }

    if (totalDeleted > 0) {
      logAuditEvent({
        action: 'auto_cleanup',
        actor: 'scheduler',
        detail: { total_deleted: totalDeleted },
      })
    }

    return { ok: true, message: `Cleaned ${totalDeleted} stale record${totalDeleted === 1 ? '' : 's'}` }
  } catch (err: any) {
    return { ok: false, message: `Cleanup failed: ${err.message}` }
  }
}

/** Check agent liveness - mark agents offline if not seen recently */
async function runHeartbeatCheck(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const timeoutMinutes = getSettingNumber('general.agent_timeout_minutes', 10)
    const threshold = now - timeoutMinutes * 60

    // Find agents that are not offline and were previously seen but haven't responded recently.
    // Agents with last_seen IS NULL have never connected and are not considered stale.
    const staleAgents = db.prepare(`
      SELECT id, name, status, last_seen FROM agents
      WHERE status != 'offline' AND last_seen IS NOT NULL AND last_seen < ?
    `).all(threshold) as Array<{ id: number; name: string; status: string; last_seen: number | null }>

    if (staleAgents.length === 0) {
      return { ok: true, message: 'All agents healthy' }
    }

    // Mark stale agents as offline
    const markOffline = db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?')
    const logActivity = db.prepare(`
      INSERT INTO activities (type, entity_type, entity_id, actor, description)
      VALUES ('agent_status_change', 'agent', ?, 'heartbeat', ?)
    `)

    const names: string[] = []
    db.transaction(() => {
      for (const agent of staleAgents) {
        markOffline.run('offline', now, agent.id)
        logActivity.run(agent.id, `Agent "${agent.name}" marked offline (no heartbeat for ${timeoutMinutes}m)`)
        names.push(agent.name)

        // Create notification for each stale agent
        try {
          db.prepare(`
            INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
            VALUES ('system', 'heartbeat', ?, ?, 'agent', ?)
          `).run(
            `Agent offline: ${agent.name}`,
            `Agent "${agent.name}" was marked offline after ${timeoutMinutes} minutes without heartbeat`,
            agent.id
          )
        } catch { /* notification creation failed */ }
      }
    })()

    logAuditEvent({
      action: 'heartbeat_check',
      actor: 'scheduler',
      detail: { marked_offline: names },
    })

    return { ok: true, message: `Marked ${staleAgents.length} agent(s) offline: ${names.join(', ')}` }
  } catch (err: any) {
    return { ok: false, message: `Heartbeat check failed: ${err.message}` }
  }
}

/** Scan workspace for todo.md and import new tasks to inbox */
async function runTodoSync(): Promise<{ created: number }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  
  // Use openclawHome or process.cwd() as root
  const root = config.openclawHome || process.cwd()
  
  function findTodoFiles(dir: string, depth = 0): string[] {
    if (depth > 4) return []
    const found: string[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const name = entry.name.toLowerCase()
        if (name.startsWith('.') || name === 'node_modules' || name === '.git') continue
        const full = join(dir, entry.name)
        if (entry.isFile() && name === 'todo.md') {
          found.push(full)
        } else if (entry.isDirectory()) {
          found.push(...findTodoFiles(full, depth + 1))
        }
      }
    } catch { /* ignore */ }
    return found
  }

  const files = findTodoFiles(root)
  let created = 0
  const existingTodoTasks = db.prepare(`
    SELECT title, metadata
    FROM tasks
    WHERE metadata LIKE '%"source":"todo_sync"%'
    LIMIT 5000
  `).all() as Array<{ title: string; metadata: string | null }>
  const existingKeys = new Set<string>()
  for (const task of existingTodoTasks) {
    if (!task.metadata) continue
    try {
      const meta = JSON.parse(task.metadata)
      const sourceFile = typeof meta?.source_file === 'string' ? meta.source_file : ''
      const title = normalizeTodoTitle(task.title || '')
      if (sourceFile && title) existingKeys.add(`${sourceFile}::${title}`)
    } catch {
      // Ignore malformed metadata
    }
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tasks (title, status, created_by, created_at, updated_at, metadata)
    VALUES (?, 'inbox', 'scheduler', ?, ?, ?)
  `)

  db.transaction(() => {
    for (const fp of files) {
      const items = parseTodoFile(fp)
      for (const title of items) {
        const normalizedTitle = normalizeTodoTitle(title)
        const dedupeKey = `${fp}::${normalizedTitle}`
        if (existingKeys.has(dedupeKey)) continue
        const meta = JSON.stringify({
          source: 'todo_sync',
          source_file: fp,
          workspace_root: findWorkspaceRootFromPath(fp),
        })
        const res = insert.run(title, now, now, meta)
        if (res.changes > 0) {
          existingKeys.add(dedupeKey)
          created++
        }
      }
    }
  })()

  return { created }
}

function parseTodoFile(filePath: string): string[] {
  const items: string[] = []
  try {
    const text = readFileSync(filePath, 'utf-8')
    const lines = text.split('\n')
    let section: 'pending' | 'in_progress' | 'done' = 'pending'

    for (const line of lines) {
      const trimmed = line.trim()
      if (/^#{1,4}\s/.test(trimmed)) {
        if (/progress|doing|ongoing|wip|current/i.test(trimmed)) section = 'in_progress'
        else if (/done|completed|finished|closed/i.test(trimmed)) section = 'done'
        else section = 'pending'
        continue
      }

      if (section !== 'done') {
        const match = trimmed.match(/^-\s+\[ \]\s+(.+)/)
        if (match) items.push(match[1].trim())
      }
    }
  } catch {
    // Ignore unreadable todo files.
  }
  return items
}

function normalizeTodoTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function repairLegacyTodoTaskState(): { requeued: number; deduped: number } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const rows = db.prepare(`
    SELECT id, title, status, metadata, updated_at
    FROM tasks
    WHERE metadata LIKE '%"source":"todo_sync"%'
    ORDER BY updated_at DESC, id DESC
    LIMIT 5000
  `).all() as Array<{
    id: number
    title: string
    status: string
    metadata: string | null
    updated_at: number
  }>

  if (rows.length === 0) return { requeued: 0, deduped: 0 }

  const byKey = new Map<string, typeof rows>()
  const openTitlesByFile = new Map<string, Set<string>>()
  let requeued = 0
  let deduped = 0

  for (const row of rows) {
    if (!row.metadata) continue
    try {
      const meta = JSON.parse(row.metadata)
      const sourceFile = typeof meta?.source_file === 'string' ? meta.source_file : ''
      const normalizedTitle = normalizeTodoTitle(row.title || '')
      if (!sourceFile || !normalizedTitle) continue
      const key = `${sourceFile}::${normalizedTitle}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(row)
    } catch {
      // Ignore malformed metadata
    }
  }

  const deleteComments = db.prepare('DELETE FROM comments WHERE task_id = ?')
  const deleteReviews = db.prepare('DELETE FROM quality_reviews WHERE task_id = ?')
  const deleteTask = db.prepare('DELETE FROM tasks WHERE id = ?')
  const updateTask = db.prepare('UPDATE tasks SET status = ?, assigned_to = NULL, metadata = ?, updated_at = ? WHERE id = ?')
  const insertComment = db.prepare('INSERT INTO comments (task_id, author, content, created_at) VALUES (?, ?, ?, ?)')
  const insertActivity = db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES (?, 'task', ?, ?, ?)`)

  db.transaction(() => {
    for (const [key, group] of byKey.entries()) {
      const [sourceFile, normalizedTitle] = key.split('::')
      let openTitles = openTitlesByFile.get(sourceFile)
      if (!openTitles) {
        openTitles = new Set(parseTodoFile(sourceFile).map(normalizeTodoTitle))
        openTitlesByFile.set(sourceFile, openTitles)
      }

      const survivor = group[0]
      for (const duplicate of group.slice(1)) {
        deleteComments.run(duplicate.id)
        deleteReviews.run(duplicate.id)
        deleteTask.run(duplicate.id)
        deduped++
      }

      if (!openTitles.has(normalizedTitle)) continue

      let meta: Record<string, any> = {}
      try {
        meta = survivor.metadata ? JSON.parse(survivor.metadata) : {}
      } catch {
        meta = {}
      }

      const changedFiles = Array.isArray(meta?.verification?.changed_files)
        ? meta.verification.changed_files
        : []
      const needsRepair = survivor.status !== 'inbox' && changedFiles.length === 0
      if (!needsRepair) continue

      const nextMeta = JSON.stringify({
        ...meta,
        progress_pct: 5,
        verification: {
          checked_at: now,
          passed: false,
          reason: 'Legacy false positive repaired automatically because the todo item is still open and no verified diff exists.',
          changed_files: [],
        },
      })
      updateTask.run('inbox', nextMeta, now, survivor.id)
      insertComment.run(
        survivor.id,
        'scheduler',
        'Automatic repair: task was re-queued because the Todo item is still unchecked and no verified implementation diff exists.',
        now,
      )
      insertActivity.run('task_requeued', survivor.id, 'scheduler', `Re-queued stale todo task ${survivor.title}`)
      requeued++
    }
  })()

  return { requeued, deduped }
}

function markDoneTodosFromTasks(): { filesUpdated: number; checkboxesMarked: number } {
  const db = getDatabase()
  const doneTasks = db.prepare(`
    SELECT title, metadata
    FROM tasks
    WHERE status = 'done' AND metadata LIKE '%"source":"todo_sync"%'
    LIMIT 500
  `).all() as Array<{ title: string; metadata: string | null }>

  const byFile = new Map<string, Map<string, number>>()
  for (const task of doneTasks) {
    if (!task.metadata) continue
    try {
      const meta = JSON.parse(task.metadata)
      if (!meta?.verification?.passed) continue
      const sourceFile = typeof meta?.source_file === 'string' ? meta.source_file : ''
      if (!sourceFile) continue
      const normalizedTitle = normalizeTodoTitle(task.title || '')
      if (!normalizedTitle) continue
      if (!byFile.has(sourceFile)) byFile.set(sourceFile, new Map())
      const countByTitle = byFile.get(sourceFile)!
      countByTitle.set(normalizedTitle, (countByTitle.get(normalizedTitle) || 0) + 1)
    } catch {
      // Ignore malformed metadata
    }
  }

  let filesUpdated = 0
  let checkboxesMarked = 0

  for (const [filePath, doneTitleCounts] of byFile.entries()) {
    if (!existsSync(filePath)) continue
    let text = ''
    try {
      text = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const lines = text.split('\n')
    let changed = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(/^(\s*-\s+)\[ \](\s+.+)$/)
      if (!match) continue
      const title = normalizeTodoTitle(match[2])
      const remaining = doneTitleCounts.get(title) || 0
      if (remaining <= 0) continue
      doneTitleCounts.set(title, remaining - 1)
      lines[i] = `${match[1]}[x]${match[2]}`
      changed = true
      checkboxesMarked++
    }

    if (changed) {
      writeFileSync(filePath, lines.join('\n'), 'utf-8')
      filesUpdated++
    }
  }

  return { filesUpdated, checkboxesMarked }
}

type QueueTask = {
  id: number
  title: string
  description: string | null
  priority: string
  status: string
}

type AgentCandidate = {
  id: number
  name: string
  role: string
  config: string | null
}

type TaskRecoveryPreferences = {
  preferredAgent?: string
  avoidAgent?: string
  directive?: string
  summary?: string
}

function parseTaskMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getTaskRecoveryPreferences(metadata: Record<string, any>): TaskRecoveryPreferences {
  const autonomous = metadata.autonomous && typeof metadata.autonomous === 'object'
    ? metadata.autonomous
    : {}
  const recoveryPlan = autonomous.recovery_plan && typeof autonomous.recovery_plan === 'object'
    ? autonomous.recovery_plan
    : {}

  return {
    preferredAgent: typeof recoveryPlan.preferred_agent === 'string' && recoveryPlan.preferred_agent ? recoveryPlan.preferred_agent : undefined,
    avoidAgent: typeof recoveryPlan.avoid_agent === 'string' && recoveryPlan.avoid_agent ? recoveryPlan.avoid_agent : undefined,
    directive: typeof recoveryPlan.instructions === 'string' && recoveryPlan.instructions ? recoveryPlan.instructions : undefined,
    summary: typeof recoveryPlan.summary === 'string' && recoveryPlan.summary ? recoveryPlan.summary : undefined,
  }
}

function getQueueCounts() {
  const db = getDatabase()
  const inbox = (db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'inbox'`).get() as any)?.c ?? 0
  const review = (db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'review'`).get() as any)?.c ?? 0
  const qualityReview = (db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'quality_review'`).get() as any)?.c ?? 0
  return { inbox, review, qualityReview }
}

function wakeOneAgentForLane(now: number, lane: 'worker' | 'reviewer'): AgentCandidate | null {
  const db = getDatabase()
  const where = lane === 'reviewer'
    ? `(LOWER(COALESCE(role, '')) LIKE '%review%' OR LOWER(name) = 'aegis')`
    : `(LOWER(COALESCE(role, '')) NOT LIKE '%review%' AND LOWER(name) != 'aegis')`

  const agents = db.prepare(
    `SELECT id, name, role, config FROM agents
     WHERE status = 'offline' AND ${where}
     ORDER BY COALESCE(last_seen, 0) DESC
     LIMIT 10`
  ).all() as AgentCandidate[]

  const agent = agents.find((candidate) => isAgentAvailable(candidate.name))
  if (!agent) return null

  db.prepare(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`).run(now, agent.id)
  db.prepare(
    `INSERT INTO activities (type, entity_type, entity_id, actor, description)
     VALUES ('agent_status_change','agent',?,'scheduler',?)`
  ).run(agent.id, `Agent "${agent.name}" woken from offline to handle ${lane} queue`)
  return agent
}

function loadIdleAgentsForLane(lane: 'worker' | 'reviewer'): AgentCandidate[] {
  const db = getDatabase()
  const where = lane === 'reviewer'
    ? `(LOWER(COALESCE(role, '')) LIKE '%review%' OR LOWER(name) = 'aegis')`
    : `(LOWER(COALESCE(role, '')) NOT LIKE '%review%' AND LOWER(name) != 'aegis')`

  const agents = db.prepare(
    `SELECT id, name, role, config FROM agents
     WHERE status = 'idle' AND ${where}
     ORDER BY id ASC`
  ).all() as AgentCandidate[]
  return agents.filter((agent) => isAgentAvailable(agent.name))
}

function popBestAgentForTask(agents: AgentCandidate[], task: QueueTask, recovery: TaskRecoveryPreferences = {}): AgentCandidate | null {
  if (agents.length === 0) return null
  if (recovery.preferredAgent) {
    const preferredIndex = agents.findIndex((agent) => agent.name === recovery.preferredAgent)
    if (preferredIndex >= 0) {
      const [preferred] = agents.splice(preferredIndex, 1)
      return preferred || null
    }
  }

  const text = `${task.title} ${task.description || ''}`.toLowerCase()

  let bestIndex = 0
  let bestScore = -1

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    const cfg = (() => { try { return JSON.parse(a.config || '{}') } catch { return {} } })()
    const specialties = Array.isArray(cfg.specialties) ? cfg.specialties : []
    const keywords = [a.name.toLowerCase(), (a.role || '').toLowerCase(), ...specialties.map((s: string) => s.toLowerCase())]
    const score = keywords.reduce((s: number, kw: string) => s + (kw && text.includes(kw) ? 1 : 0), 0)
    const adjustedScore = recovery.avoidAgent && a.name === recovery.avoidAgent ? score - 100 : score
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore
      bestIndex = i
    }
  }

  const [selected] = agents.splice(bestIndex, 1)
  return selected || null
}

function fetchQueueTasks(status: 'inbox' | 'review' | 'quality_review'): QueueTask[] {
  const db = getDatabase()
  if (status === 'inbox') {
    return db.prepare(`
      SELECT id, title, description, priority, status
      FROM tasks
      WHERE status = 'inbox'
      ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT 20
    `).all() as QueueTask[]
  }

  return db.prepare(`
    SELECT id, title, description, priority, status
    FROM tasks
    WHERE status = ?
      AND (
        assigned_to IS NULL
        OR assigned_to = ''
        OR LOWER(assigned_to) NOT IN (
          SELECT LOWER(name) FROM agents
          WHERE LOWER(COALESCE(role, '')) LIKE '%review%'
             OR LOWER(name) = 'aegis'
        )
      )
    ORDER BY
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 20
  `).all(status) as QueueTask[]
}

function dispatchTasksForLane(
  now: number,
  status: 'inbox' | 'review' | 'quality_review',
  lane: 'worker' | 'reviewer'
): number {
  const db = getDatabase()
  const queueTasks = fetchQueueTasks(status)
  if (queueTasks.length === 0) return 0

  let dispatched = 0
  const availableAgents = loadIdleAgentsForLane(lane)

  for (const task of queueTasks) {
    if (availableAgents.length === 0) {
      const woken = wakeOneAgentForLane(now, lane)
      if (woken) availableAgents.push(woken)
    }

    const currentTaskRow = db.prepare(`SELECT metadata, created_at, updated_at, estimated_hours, actual_hours, status FROM tasks WHERE id = ?`).get(task.id) as any
    const currentMetadata = parseTaskMetadata(currentTaskRow?.metadata)
    const autonomous = currentMetadata?.autonomous && typeof currentMetadata.autonomous === 'object'
      ? currentMetadata.autonomous
      : {}
    const recovery = getTaskRecoveryPreferences(currentMetadata)
    const agent = popBestAgentForTask(availableAgents, task, recovery)
    if (!agent) break
    if (status === 'inbox') {
      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTaskRow?.status || task.status,
        created_at: currentTaskRow?.created_at || now,
        updated_at: currentTaskRow?.updated_at || now,
        estimated_hours: currentTaskRow?.estimated_hours,
        actual_hours: currentTaskRow?.actual_hours,
        metadata: currentMetadata,
      }, 'in_progress', now, {
        ...currentMetadata,
        autonomous: {
          ...autonomous,
          assignment_count: Number(autonomous.assignment_count || 0) + 1,
          last_assigned_at: now,
          last_assigned_lane: lane,
          debate_pending: false,
        },
      })
      db.prepare(`UPDATE tasks SET status = 'in_progress', assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(agent.name, JSON.stringify(nextMetadata), now, task.id)
    } else {
      const nextMetadata = mergeTaskProgressMetadata({
        status: currentTaskRow?.status || task.status,
        created_at: currentTaskRow?.created_at || now,
        updated_at: currentTaskRow?.updated_at || now,
        estimated_hours: currentTaskRow?.estimated_hours,
        actual_hours: currentTaskRow?.actual_hours,
        metadata: currentMetadata,
      }, status, now, {
        ...currentMetadata,
        autonomous: {
          ...autonomous,
          assignment_count: Number(autonomous.assignment_count || 0) + 1,
          last_assigned_at: now,
          last_assigned_lane: lane,
          debate_pending: false,
        },
      })
      db.prepare(`UPDATE tasks SET assigned_to = ?, metadata = ?, updated_at = ? WHERE id = ?`)
        .run(agent.name, JSON.stringify(nextMetadata), now, task.id)
    }

    const stageLabel = status === 'inbox' ? 'inbox' : status === 'review' ? 'review' : 'quality review'
    const taskDesc = task.title + (task.description ? `\n\n${task.description}` : '')
    const recoveryDirective = recovery.directive
      ? `\n\nOrchestrator recovery directive:\n${recovery.summary || 'Retry directive'}\n${recovery.directive}`
      : ''
    const prompt = status === 'inbox'
      ? `${taskDesc}${recoveryDirective}`
      : `Handle ${stageLabel} for task #${task.id}.\n\n${taskDesc}${recoveryDirective}\n\nProvide review findings and finalize this stage.`

    spawnAgentTask(agent.name, task.id, prompt)

    db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'orchestrator', ?, ?)`)
      .run(task.id, `🤖 **Auto-assigned** → ${agent.name} (${stageLabel} queue)${recovery.summary ? `\n\n${recovery.summary}` : ''}`, now)
    db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_assigned','task',?,'orchestrator',?)`)
      .run(task.id, `Auto-assigned from ${stageLabel} queue to ${agent.name}`)
    dispatched++
  }

  return dispatched
}

async function runAutonomousDevelopmentLoop(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const settings = getAutonomousLoopSettings()
    if (!settings.enabled) {
      return { ok: true, message: 'Autonomous development loop is disabled' }
    }

    const spawned = runAutoSpawnAgents(now, settings)
    const healed = runRepoSelfHeal(now, settings)
    const thirtyMinuteReview = runThirtyMinuteTaskReviews(now, settings)
    const recovery = runOrchestratorRecoveryLoop(now, settings)
    const debated = runAgentDebateSystem(now, settings)
    const dispatch = await runOrchestratorDispatch()
    const progress = await runAutoProgressTasks()

    const parts: string[] = []
    if (spawned.created > 0) {
      parts.push(`spawned ${spawned.created} agent(s)`)
    }
    if (healed.healedRepos > 0) {
      parts.push(`healed ${healed.healedRepos} repo(s) (${healed.actions} action${healed.actions === 1 ? '' : 's'})`)
    }
    if (thirtyMinuteReview.reviewed > 0) {
      parts.push(`reviewed ${thirtyMinuteReview.reviewed} 30-minute task(s)`)
    }
    if (recovery.reviewed > 0) {
      parts.push(`orchestrator recovery ${recovery.reviewed} task(s)`)
    }
    if (debated.debated > 0) {
      parts.push(`debated ${debated.debated} task(s)`)
    }
    if (dispatch.message && dispatch.message !== 'No dispatchable work found') {
      parts.push(dispatch.message)
    }
    if (progress.message && progress.message !== 'No stalled tasks found') {
      parts.push(progress.message)
    }

    logAuditEvent({
      action: 'autonomous_dev_loop',
      actor: 'scheduler',
      detail: {
        spawned,
        healed,
        thirtyMinuteReview,
        recovery,
        debated,
        dispatch: dispatch.message,
        progress: progress.message,
      },
    })

    return {
      ok: dispatch.ok && progress.ok,
      message: parts.length > 0 ? parts.join(' | ') : 'Autonomous loop checked queues with no action needed',
    }
  } catch (err: any) {
    return { ok: false, message: `Autonomous development loop failed: ${err.message}` }
  }
}

/** Auto-orchestrate queues: inbox -> workers, review/quality_review -> reviewers. */
async function runOrchestratorDispatch(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const repairRes = repairLegacyTodoTaskState()
    const startingQueues = getQueueCounts()

    let todoImported = 0
    let todoFilesUpdated = 0
    let todoCheckboxesMarked = 0

    if (startingQueues.inbox === 0 && startingQueues.review === 0 && startingQueues.qualityReview === 0) {
      const markRes = markDoneTodosFromTasks()
      todoFilesUpdated = markRes.filesUpdated
      todoCheckboxesMarked = markRes.checkboxesMarked

      const syncRes = await runTodoSync()
      todoImported = syncRes.created
    }

    let inboxDispatched = 0
    let reviewDispatched = 0
    let qualityDispatched = 0

    for (let round = 0; round < 5; round++) {
      const inboxRound = dispatchTasksForLane(now, 'inbox', 'worker')
      const reviewRound = dispatchTasksForLane(now, 'review', 'reviewer')
      const qualityRound = dispatchTasksForLane(now, 'quality_review', 'reviewer')
      const dispatchedThisRound = inboxRound + reviewRound + qualityRound

      inboxDispatched += inboxRound
      reviewDispatched += reviewRound
      qualityDispatched += qualityRound
      if (dispatchedThisRound === 0) break

      const remaining = getQueueCounts()
      if (remaining.inbox === 0 && remaining.review === 0 && remaining.qualityReview === 0) break
    }

    const totalDispatched = inboxDispatched + reviewDispatched + qualityDispatched
    if (totalDispatched > 0) {
      const counts = getQueueCounts()
      const started = startingQueues.inbox + startingQueues.review + startingQueues.qualityReview + todoImported
      const remaining = counts.inbox + counts.review + counts.qualityReview
      const completedInRun = Math.max(0, started - remaining - totalDispatched)
      logAuditEvent({
        action: 'orchestrator_dispatch',
        actor: 'scheduler',
        detail: {
          dispatched: totalDispatched,
          queue_remaining: counts,
          todo_imported: todoImported,
          todo_files_updated: todoFilesUpdated,
          todo_checkboxes_marked: todoCheckboxesMarked,
          completed_while_running: completedInRun,
        },
      })
    }

    const parts: string[] = []
    if (inboxDispatched > 0) parts.push(`${inboxDispatched} inbox task(s) assigned`)
    if (reviewDispatched > 0) parts.push(`${reviewDispatched} review task(s) assigned`)
    if (qualityDispatched > 0) parts.push(`${qualityDispatched} quality-review task(s) assigned`)
    if (todoImported > 0) parts.push(`imported ${todoImported} from todo.md`)
    if (todoCheckboxesMarked > 0) parts.push(`checked ${todoCheckboxesMarked} todo.md item(s)`)
    if (repairRes.requeued > 0) parts.push(`re-queued ${repairRes.requeued} stale todo task(s)`)
    if (repairRes.deduped > 0) parts.push(`deduped ${repairRes.deduped} duplicate todo task(s)`)

    return { ok: true, message: parts.length > 0 ? parts.join(' | ') : 'No dispatchable work found' }
  } catch (err: any) {
    return { ok: false, message: `Orchestrator dispatch failed: ${err.message}` }
  }
}

/**
 * Requeue stalled tasks instead of silently advancing workflow stages.
 * This prevents false positives where a task reaches done without verified work.
 */
async function runAutoProgressTasks(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    const thresholdHours = getSettingNumber('auto_progress.threshold_hours', 1)
    const threshold = now - thresholdHours * 3600

    const rows = db.prepare(`
      SELECT id, status, assigned_to, title FROM tasks
      WHERE status IN ('assigned','in_progress','review','quality_review')
        AND updated_at IS NOT NULL
        AND updated_at < ?
      LIMIT 50
    `).all(threshold) as Array<{ id: number; status: string; assigned_to: string | null; title: string }>

    if (rows.length === 0) return { ok: true, message: 'No stalled tasks' }

    const updateStmt = db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?')
    const insertComment = db.prepare('INSERT INTO comments (task_id, author, content, created_at) VALUES (?, ?, ?, ?)')
    const activityStmt = db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES (?, 'task', ?, 'monitor', ?)`)

    let progressed = 0
    db.transaction(() => {
      for (const t of rows) {
        let nextStatus: string | null = null
        let comment = ''
        let nextAssignee: string | null = null

        switch (t.status) {
          case 'assigned':
            nextStatus = 'inbox'
            comment = 'Monitor: re-queued task after inactivity so orchestrator can assign a fresh worker.'
            break
          case 'in_progress':
            nextStatus = 'inbox'
            comment = 'Monitor: re-queued task after inactivity instead of advancing workflow without verified output.'
            break
          case 'review':
            nextStatus = 'review'
            comment = 'Monitor: cleared stale reviewer assignment so review can be retried.'
            break
          case 'quality_review':
            nextStatus = 'quality_review'
            comment = 'Monitor: cleared stale quality-review assignment. Task stays in quality review until a reviewer verifies it.'
            nextAssignee = null
            updateStmt.run(nextStatus, nextAssignee, now, t.id)
            insertComment.run(t.id, 'monitor', comment, now)
            activityStmt.run('task_requeued', t.id, `Cleared stale quality-review assignment for task ${t.title}`)
            progressed++
            continue
          default:
            continue
        }

        if (nextStatus) {
          updateStmt.run(nextStatus, nextAssignee, now, t.id)
          insertComment.run(t.id, 'monitor', comment, now)
          activityStmt.run('task_requeued', t.id, `Monitor re-queued task to ${nextStatus}`)
          progressed++
        }
      }
    })()

    return { ok: true, message: `Progressed ${progressed} stalled task(s)` }
  } catch (err: any) {
    return { ok: false, message: `Auto-progress failed: ${err.message}` }
  }
}

/**
 * Scheduled agent runs — replaces OpenClaw auto-start sessions.
 * For each registered orchestrator project that has been idle for N minutes
 * and has a pending task, spawns a direct orchestrator (Groq) run.
 */
async function runScheduledAgentRuns(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    const projects = db.prepare(
      `SELECT id, name, folder FROM orchestrator_projects ORDER BY updated_at DESC`
    ).all() as Array<{ id: number; name: string; folder: string }>

    if (projects.length === 0) return { ok: true, message: 'No orchestrator projects registered' }

    const idleMinutes = getSettingNumber('scheduled_runs.idle_threshold_minutes', 30)
    const idleThreshold = now - idleMinutes * 60
    let started = 0

    for (const project of projects) {
      if (!existsSync(join(project.folder, 'index.js'))) continue

      // Skip if project had a run recently or one is still active
      const recentRun = db.prepare(
        `SELECT id FROM orchestrator_runs WHERE project_id = ? AND (status = 'running' OR started_at > ?) LIMIT 1`
      ).get(project.id, idleThreshold) as any
      if (recentRun) continue

      // Pick oldest pending task (unassigned or assigned to AI Orchestrator)
      const task = db.prepare(`
        SELECT id, title, description FROM tasks
        WHERE status IN ('inbox','assigned')
          AND (assigned_to IS NULL OR assigned_to = 'AI Orchestrator')
        ORDER BY created_at ASC LIMIT 1
      `).get() as any
      if (!task) continue

      const taskDesc = `Scheduled run: ${task.title}${task.description ? `\n\n${task.description}` : ''}`
      const runRow = db.prepare(
        `INSERT INTO orchestrator_runs (project_id, folder, task_description, status, started_at, task_id) VALUES (?, ?, ?, 'running', ?, ?)`
      ).run(project.id, project.folder, taskDesc, now, task.id)
      const runId = runRow.lastInsertRowid as number

      db.prepare(`UPDATE tasks SET status = 'in_progress', assigned_to = 'AI Orchestrator', updated_at = ? WHERE id = ?`).run(now, task.id)
      db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'scheduler', ?, ?)`)
        .run(task.id, `⏱️ **Scheduled run** started (Run #${runId}) — project "${project.name}"`, now)

      spawnOrchestrator(runId, project.folder, taskDesc)
      logAuditEvent({ action: 'scheduled_run_start', actor: 'scheduler', detail: { run_id: runId, project: project.name, task_id: task.id } })
      started++
    }

    return { ok: true, message: started > 0 ? `Started ${started} scheduled run(s)` : 'No projects due for scheduling' }
  } catch (err: any) {
    return { ok: false, message: `Scheduled runs failed: ${err.message}` }
  }
}

/**
 * Groq fallback — if the orchestrator has been idle for N minutes and inbox tasks
 * exist, activate the Groq agent directly to handle pending work.
 */
async function runGroqFallback(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const timeoutMinutes = getSettingNumber('groq_fallback.timeout_minutes', 10)
    const threshold = now - timeoutMinutes * 60

    // If orchestrator ran within the window, skip
    const recentRun = db.prepare(
      `SELECT id FROM orchestrator_runs WHERE started_at > ? LIMIT 1`
    ).get(threshold) as any
    if (recentRun) return { ok: true, message: 'Orchestrator active — Groq fallback not needed' }

    const inboxTasks = db.prepare(`
      SELECT id, title, description, priority FROM tasks
      WHERE status = 'inbox'
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               created_at ASC
      LIMIT 5
    `).all() as Array<{ id: number; title: string; description: string | null; priority: string }>
    if (inboxTasks.length === 0) return { ok: true, message: 'No inbox tasks — Groq fallback idle' }

    const groqAgent = db.prepare(
      `SELECT id, name FROM agents WHERE LOWER(name) LIKE '%groq%' LIMIT 1`
    ).get() as any
    if (!groqAgent) return { ok: false, message: 'Groq agent not found in registry' }

    db.prepare(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE id = ?`)
      .run(`🔄 Fallback: ${inboxTasks.length} task(s)`, now, now, groqAgent.id)

    let dispatched = 0
    db.transaction(() => {
      for (const task of inboxTasks) {
        db.prepare(`UPDATE tasks SET status = 'assigned', assigned_to = ?, updated_at = ? WHERE id = ?`).run(groqAgent.name, now, task.id)
        db.prepare(`INSERT INTO comments (task_id, author, content, created_at) VALUES (?, 'groq-fallback', ?, ?)`)
          .run(task.id, `🔄 **Groq Fallback** — Orchestrator idle ${timeoutMinutes}+ min. Routed to **${groqAgent.name}**.`, now)
        db.prepare(`INSERT INTO activities (type, entity_type, entity_id, actor, description) VALUES ('task_assigned','task',?,'groq-fallback',?)`)
          .run(task.id, `Groq fallback: assigned to ${groqAgent.name}`)
        dispatched++
      }
    })()

    logAuditEvent({ action: 'groq_fallback_dispatch', actor: 'scheduler', detail: { task_count: dispatched, timeout_minutes: timeoutMinutes, agent: groqAgent.name } })
    return { ok: true, message: `Groq fallback: dispatched ${dispatched} task(s) to ${groqAgent.name}` }
  } catch (err: any) {
    return { ok: false, message: `Groq fallback failed: ${err.message}` }
  }
}

const DAILY_MS = 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const TICK_MS = 60 * 1000 // Check every minute

/** Initialize the scheduler */
export function initScheduler() {
  if (tickInterval) return // Already running

  // Auto-sync agents from openclaw.json on startup
  syncAgentsFromConfig('startup').catch(err => {
    logger.warn({ err }, 'Agent auto-sync failed')
  })

  // Register tasks
  const now = Date.now()
  // Stagger the initial runs: backup at ~3 AM, cleanup at ~4 AM (relative to process start)
  const msUntilNextBackup = getNextDailyMs(3)
  const msUntilNextCleanup = getNextDailyMs(4)

  tasks.set('auto_backup', {
    name: 'Auto Backup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextBackup,
    enabled: true,
    running: false,
  })

  tasks.set('auto_cleanup', {
    name: 'Auto Cleanup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextCleanup,
    enabled: true,
    running: false,
  })

  tasks.set('agent_heartbeat', {
    name: 'Agent Heartbeat Check',
    intervalMs: FIVE_MINUTES_MS,
    lastRun: null,
    nextRun: now + FIVE_MINUTES_MS,
    enabled: true,
    running: false,
  })

  tasks.set('webhook_retry', {
    name: 'Webhook Retry',
    intervalMs: TICK_MS, // Every 60s, matching scheduler tick resolution
    lastRun: null,
    nextRun: now + TICK_MS,
    enabled: true,
    running: false,
  })

  tasks.set('claude_session_scan', {
    name: 'Claude Session Scan',
    intervalMs: TICK_MS, // Every 60s — lightweight file stat checks
    lastRun: null,
    nextRun: now + 5_000, // First scan 5s after startup
    enabled: true,
    running: false,
  })

  tasks.set('orchestrator_dispatch', {
    name: 'Orchestrator Auto-Dispatch',
    intervalMs: TICK_MS, // Every 60s — check for inbox tasks and route them
    lastRun: null,
    nextRun: now + 10_000, // First run 10s after startup
    enabled: true,
    running: false,
  })

  tasks.set('autonomous_dev_loop', {
    name: 'Autonomous Development Loop',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 12_000,
    enabled: true,
    running: false,
  })

  tasks.set('auto_progress', {
    name: 'Auto Progress Stalled Tasks',
    intervalMs: TICK_MS, // Every 60s — evaluate stalled tasks and advance
    lastRun: null,
    nextRun: now + 15_000, // First run 15s after startup
    enabled: true,
    running: false,
  })

  tasks.set('scheduled_agent_runs', {
    name: 'Scheduled Agent Runs',
    intervalMs: 5 * 60 * 1000, // Every 5 minutes — direct orchestrator runs, no OpenClaw
    lastRun: null,
    nextRun: now + 20_000, // First run 20s after startup
    enabled: true,
    running: false,
  })

  tasks.set('groq_fallback', {
    name: 'Groq Fallback (10-min)',
    intervalMs: 2 * 60 * 1000, // Check every 2 minutes
    lastRun: null,
    nextRun: now + 10 * 60 * 1000, // First check after 10 min (give orchestrator time to start)
    enabled: true,
    running: false,
  })

  // Seed defaults: Team Lead Mode on (AI agent on all task steps)
  try {
    const db = getDatabase()
    const existing = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.team_lead_mode'`).get() as any
    if (!existing) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.team_lead_mode', 'true')`).run()
    }
    // Ensure groq_fallback timeout default is stored
    const fbTimeout = db.prepare(`SELECT value FROM settings WHERE key = 'groq_fallback.timeout_minutes'`).get() as any
    if (!fbTimeout) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('groq_fallback.timeout_minutes', '10')`).run()
    }
    const keepIdle = db.prepare(`SELECT value FROM settings WHERE key = 'general.orchestrator_set_idle_after_run'`).get() as any
    if (!keepIdle) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('general.orchestrator_set_idle_after_run', 'true')`).run()
    }
    const autonomousLoop = db.prepare(`SELECT value FROM settings WHERE key = 'general.autonomous_dev_loop'`).get() as any
    if (!autonomousLoop) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('general.autonomous_dev_loop', 'true')`).run()
    }
    const autoSpawn = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.auto_spawn_agents'`).get() as any
    if (!autoSpawn) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.auto_spawn_agents', 'true')`).run()
    }
    const debateEnabled = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.agent_debate_enabled'`).get() as any
    if (!debateEnabled) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.agent_debate_enabled', 'true')`).run()
    }
    const selfHeal = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.repo_self_heal'`).get() as any
    if (!selfHeal) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.repo_self_heal', 'true')`).run()
    }
    const maxWorkers = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.max_auto_spawn_workers'`).get() as any
    if (!maxWorkers) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.max_auto_spawn_workers', '2')`).run()
    }
    const maxReviewers = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.max_auto_spawn_reviewers'`).get() as any
    if (!maxReviewers) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.max_auto_spawn_reviewers', '1')`).run()
    }
    const debateThreshold = db.prepare(`SELECT value FROM settings WHERE key = 'orchestrator.max_task_attempts_before_debate'`).get() as any
    if (!debateThreshold) {
      db.prepare(`INSERT INTO settings (key, value) VALUES ('orchestrator.max_task_attempts_before_debate', '2')`).run()
    }
  } catch { /* settings table may not be ready yet */ }

  // Start the tick loop
  tickInterval = setInterval(tick, TICK_MS)
  logger.info('Scheduler initialized - Team Lead Mode: ON, Groq fallback: 10min, Scheduled runs: every 5min (no OpenClaw)')
  // Kick off immediate dispatch and auto-progress pass
  if (isSettingEnabled('general.autonomous_dev_loop', true)) {
    runAutonomousDevelopmentLoop().catch(err => logger.warn({ err }, 'Initial autonomous development loop failed'))
  } else {
    runOrchestratorDispatch().catch(err => logger.warn({ err }, 'Initial orchestrator dispatch failed'))
    runAutoProgressTasks().catch(err => logger.warn({ err }, 'Initial auto-progress failed'))
  }
}

/** Calculate ms until next occurrence of a given hour (UTC) */
function getNextDailyMs(hour: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/** Check and run due tasks */
async function tick() {
  const now = Date.now()
  const autonomousLoopEnabled = isSettingEnabled('general.autonomous_dev_loop', true)

  for (const [id, task] of tasks) {
    if (task.running || now < task.nextRun) continue
    if (autonomousLoopEnabled && (id === 'orchestrator_dispatch' || id === 'auto_progress')) continue
    if (!autonomousLoopEnabled && id === 'autonomous_dev_loop') continue

    // Check if this task is enabled in settings (heartbeat is always enabled)
    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : id === 'webhook_retry' ? 'webhooks.retry_enabled'
      : id === 'claude_session_scan' ? 'general.claude_session_scan'
      : id === 'autonomous_dev_loop' ? 'general.autonomous_dev_loop'
      : id === 'orchestrator_dispatch' ? 'general.orchestrator_dispatch'
      : id === 'auto_progress' ? 'general.auto_progress'
      : id === 'scheduled_agent_runs' ? 'general.scheduled_agent_runs'
      : id === 'groq_fallback' ? 'general.groq_fallback'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan'
      || id === 'autonomous_dev_loop' || id === 'orchestrator_dispatch' || id === 'auto_progress' || id === 'scheduled_agent_runs' || id === 'groq_fallback'
    if (!isSettingEnabled(settingKey, defaultEnabled)) continue

    task.running = true
    try {
      const result = id === 'auto_backup' ? await runBackup()
        : id === 'agent_heartbeat' ? await runHeartbeatCheck()
        : id === 'webhook_retry' ? await processWebhookRetries()
        : id === 'claude_session_scan' ? await syncClaudeSessions()
        : id === 'autonomous_dev_loop' ? await runAutonomousDevelopmentLoop()
        : id === 'orchestrator_dispatch' ? await runOrchestratorDispatch()
        : id === 'auto_progress' ? await runAutoProgressTasks()
        : id === 'scheduled_agent_runs' ? await runScheduledAgentRuns()
        : id === 'groq_fallback' ? await runGroqFallback()
        : await runCleanup()
      task.lastResult = { ...result, timestamp: now }
    } catch (err: any) {
      task.lastResult = { ok: false, message: err.message, timestamp: now }
    } finally {
      task.running = false
      task.lastRun = now
      task.nextRun = now + task.intervalMs
    }
  }
}

/** Get scheduler status (for API) */
export function getSchedulerStatus() {
  const result: Array<{
    id: string
    name: string
    enabled: boolean
    lastRun: number | null
    nextRun: number
    running: boolean
    lastResult?: { ok: boolean; message: string; timestamp: number }
  }> = []
  const autonomousLoopEnabled = isSettingEnabled('general.autonomous_dev_loop', true)

  for (const [id, task] of tasks) {
    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : id === 'webhook_retry' ? 'webhooks.retry_enabled'
      : id === 'claude_session_scan' ? 'general.claude_session_scan'
      : id === 'autonomous_dev_loop' ? 'general.autonomous_dev_loop'
      : id === 'orchestrator_dispatch' ? 'general.orchestrator_dispatch'
      : id === 'auto_progress' ? 'general.auto_progress'
      : id === 'scheduled_agent_runs' ? 'general.scheduled_agent_runs'
      : id === 'groq_fallback' ? 'general.groq_fallback'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan'
      || id === 'autonomous_dev_loop' || id === 'orchestrator_dispatch' || id === 'auto_progress' || id === 'scheduled_agent_runs' || id === 'groq_fallback'
    const enabledBySettings = isSettingEnabled(settingKey, defaultEnabled)
    const enabled = id === 'autonomous_dev_loop'
      ? enabledBySettings && autonomousLoopEnabled
      : (id === 'orchestrator_dispatch' || id === 'auto_progress')
      ? enabledBySettings && !autonomousLoopEnabled
      : enabledBySettings
    result.push({
      id,
      name: task.name,
      enabled,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      running: task.running,
      lastResult: task.lastResult,
    })
  }

  return result
}

/** Manually trigger a scheduled task */
export async function triggerTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  if (taskId === 'auto_backup') return runBackup()
  if (taskId === 'auto_cleanup') return runCleanup()
  if (taskId === 'agent_heartbeat') return runHeartbeatCheck()
  if (taskId === 'webhook_retry') return processWebhookRetries()
  if (taskId === 'claude_session_scan') return syncClaudeSessions()
  if (taskId === 'autonomous_dev_loop') return runAutonomousDevelopmentLoop()
  if (taskId === 'orchestrator_dispatch') return runOrchestratorDispatch()
  if (taskId === 'auto_progress') return runAutoProgressTasks()
  if (taskId === 'scheduled_agent_runs') return runScheduledAgentRuns()
  if (taskId === 'groq_fallback') return runGroqFallback()
  return { ok: false, message: `Unknown task: ${taskId}` }
}

/** Stop the scheduler */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}
