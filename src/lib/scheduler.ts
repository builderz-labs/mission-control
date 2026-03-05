import { getDatabase, logAuditEvent } from './db'
import { syncAgentsFromConfig } from './agent-sync'
import { config, ensureDirExists } from './config'
import { join, dirname } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { logger } from './logger'
import { processWebhookRetries } from './webhooks'
import { syncClaudeSessions } from './claude-sessions'
import { runOpenClaw } from './command'
import { getNovaFrontDoorName } from './identity-alias'

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

    // Find agents that are not offline but haven't been seen recently
    const staleAgents = db.prepare(`
      SELECT id, name, status, last_seen FROM agents
      WHERE status != 'offline' AND (last_seen IS NULL OR last_seen < ?)
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

async function runOfficeAutopilot(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const blockedMinutes = getSettingNumber('office.autopilot_blocked_minutes', 30)
    const blockedThreshold = now - blockedMinutes * 60

    const totalOpen = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status != 'done'`).get() as any)?.c || 0
    const blocked = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'blocked' AND updated_at < ?`).get(blockedThreshold) as any)?.c || 0
    const approvalsPending = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'needs-approval'`).get() as any)?.c || 0
    const reviewMain = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'review' AND (metadata LIKE '%"scope":"main"%' OR metadata LIKE '%"isMainTask":true%')`).get() as any)?.c || 0

    const conductor = db.prepare(`SELECT id, name, session_key FROM agents WHERE lower(name) = 'conductor' LIMIT 1`).get() as any

    // Auto-triage: inbox/backlog tasks get assigned to Conductor and moved to todo
    let triaged = 0
    if (conductor?.name) {
      const triageCandidates = db.prepare(`
        SELECT id, title, status
        FROM tasks
        WHERE status IN ('inbox', 'backlog')
          AND (assigned_to IS NULL OR assigned_to = '')
        ORDER BY created_at ASC
        LIMIT 50
      `).all() as Array<{ id: number; title: string; status: string }>

      if (triageCandidates.length > 0) {
        const assignStmt = db.prepare(`UPDATE tasks SET assigned_to = ?, status = 'todo', updated_at = ? WHERE id = ?`)
        const activityStmt = db.prepare(`
          INSERT INTO activities (type, entity_type, entity_id, actor, description, data, created_at)
          VALUES ('task_updated', 'task', ?, 'office_autopilot', ?, ?, ?)
        `)

        db.transaction(() => {
          for (const task of triageCandidates) {
            assignStmt.run(conductor.name, now, task.id)
            activityStmt.run(
              task.id,
              `Autopilot triaged task \"${task.title}\" to ${conductor.name}`,
              JSON.stringify({ oldStatus: task.status, newStatus: 'todo', assigned_to: conductor.name }),
              now,
            )
            triaged += 1
          }
        })()
      }
    }

    const isComplex = blocked + approvalsPending + reviewMain >= 2
    const routedModel = isComplex
      ? (process.env.MC_AUTOPILOT_COMPLEX_MODEL || 'openai/gpt-5.2')
      : (process.env.MC_AUTOPILOT_ROUTINE_MODEL || 'ollama/qwen3.5-4b-local')

    const summary = [
      `Office autopilot heartbeat`,
      `Open tasks: ${totalOpen}`,
      `Blocked>${blockedMinutes}m: ${blocked}`,
      `Needs approval: ${approvalsPending}`,
      `Main tasks in review: ${reviewMain}`,
      `Triaged to Conductor: ${triaged}`,
      `Routed model: ${routedModel}`,
    ].join(' | ')

    let delivered = false

    if (conductor?.session_key) {
      try {
        await runOpenClaw(
          ['gateway', 'sessions_send', '--session', conductor.session_key, '--message', summary],
          { timeoutMs: 12000 }
        )
        delivered = true
      } catch (err) {
        logger.warn({ err }, 'office_autopilot: failed to message conductor')
      }
    }

    if (blocked > 0 || approvalsPending > 0 || reviewMain > 0) {
      db.prepare(`
        INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
        VALUES (?, 'office_autopilot', ?, ?, 'task', NULL)
      `).run(getNovaFrontDoorName(), 'Office requires attention', summary)
    }

    db.prepare(`
      INSERT INTO office_autopilot_runs (
        cycle_type, routed_model, routed_agent, summary,
        tasks_scanned, blocked_found, approvals_pending, escalations_created, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'heartbeat',
      routedModel,
      'conductor',
      summary,
      totalOpen,
      blocked,
      approvalsPending + reviewMain,
      blocked + approvalsPending + reviewMain,
      JSON.stringify({ deliveredToConductor: delivered, triagedToConductor: triaged }),
      now,
    )

    logAuditEvent({
      action: 'office_autopilot',
      actor: 'scheduler',
      detail: { totalOpen, blocked, approvalsPending, reviewMain, triaged, routedModel, delivered },
    })

    return { ok: true, message: summary }
  } catch (err: any) {
    return { ok: false, message: `Office autopilot failed: ${err.message}` }
  }
}

const DAILY_MS = 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const TWO_MINUTES_MS = 2 * 60 * 1000
const TICK_MS = 60 * 1000 // Check every minute

/** Initialize the scheduler */
export function initScheduler() {
  if (tickInterval) return // Already running

  // Auto-sync agents from openclaw.json on startup
  syncAgentsFromConfig('startup').catch(err => {
    logger.warn({ err }, 'Agent auto-sync failed')
  })

  // Start always-on OpenClaw mirror (tasks + comms) so MC feels like an office on entry
  initOpenClawMirror()

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

  tasks.set('office_autopilot', {
    name: 'Office Autopilot',
    intervalMs: TWO_MINUTES_MS,
    lastRun: null,
    nextRun: now + TWO_MINUTES_MS,
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

  // Start the tick loop
  tickInterval = setInterval(tick, TICK_MS)
  logger.info('Scheduler initialized - backup at ~3AM, cleanup at ~4AM, heartbeat every 5m, office autopilot every 2m, webhook retry every 60s, claude scan every 60s')
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

  for (const [id, task] of tasks) {
    if (task.running || now < task.nextRun) continue

    // Check if this task is enabled in settings (heartbeat is always enabled)
    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : id === 'webhook_retry' ? 'webhooks.retry_enabled'
      : id === 'claude_session_scan' ? 'general.claude_session_scan'
      : id === 'office_autopilot' ? 'office.autopilot_enabled'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'office_autopilot' || id === 'webhook_retry' || id === 'claude_session_scan'
    if (!isSettingEnabled(settingKey, defaultEnabled)) continue

    task.running = true
    try {
      const result = id === 'auto_backup' ? await runBackup()
        : id === 'agent_heartbeat' ? await runHeartbeatCheck()
        : id === 'office_autopilot' ? await runOfficeAutopilot()
        : id === 'webhook_retry' ? await processWebhookRetries()
        : id === 'claude_session_scan' ? await syncClaudeSessions()
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

  for (const [id, task] of tasks) {
    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : id === 'webhook_retry' ? 'webhooks.retry_enabled'
      : id === 'claude_session_scan' ? 'general.claude_session_scan'
      : id === 'office_autopilot' ? 'office.autopilot_enabled'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'office_autopilot' || id === 'webhook_retry' || id === 'claude_session_scan'
    result.push({
      id,
      name: task.name,
      enabled: isSettingEnabled(settingKey, defaultEnabled),
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
  if (taskId === 'office_autopilot') return runOfficeAutopilot()
  if (taskId === 'webhook_retry') return processWebhookRetries()
  if (taskId === 'claude_session_scan') return syncClaudeSessions()
  return { ok: false, message: `Unknown task: ${taskId}` }
}

/** Stop the scheduler */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}

// --- OpenClaw live mirror (always-on) ---
let openclawMirrorInterval: ReturnType<typeof setInterval> | null = null

function initOpenClawMirror() {
  if (openclawMirrorInterval) return

  // Allow disabling via settings
  const enabled = isSettingEnabled('openclaw.mirror_enabled', true)
  if (!enabled) return

  // 1s cadence feels real-time without being too heavy
  const intervalMs = getSettingNumber('openclaw.mirror_interval_ms', 1000)

  // Lazy import to avoid affecting build phase
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mirrorOpenClawTasksAndComms } = require('./openclaw-mirror') as typeof import('./openclaw-mirror')

  openclawMirrorInterval = setInterval(() => {
    try {
      mirrorOpenClawTasksAndComms()
    } catch (err) {
      // Best-effort: don't crash scheduler
      logger.debug({ err }, 'OpenClaw mirror tick failed')
    }
  }, intervalMs)

  logger.info({ intervalMs }, 'OpenClaw mirror started')
}
