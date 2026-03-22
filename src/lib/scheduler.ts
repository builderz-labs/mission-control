import { getDatabase, logAuditEvent } from './db'
import { syncAgentsFromConfig } from './agent-sync'
import { config, ensureDirExists } from './config'
import { join, dirname } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { logger } from './logger'
import { processWebhookRetries } from './webhooks'
import { syncClaudeSessions } from './claude-sessions'
import { pruneGatewaySessionsOlderThan, getAgentLiveStatuses } from './sessions'
import { eventBus } from './event-bus'
import { syncSkillsFromDisk } from './skill-sync'
import { syncLocalAgents } from './local-agent-sync'
import { dispatchAssignedTasks, runAegisReviews, requeueStaleTasks, autoRouteInboxTasks } from './task-dispatch'
import { spawnRecurringTasks } from './recurring-tasks'

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

    if (ret.gatewaySessions > 0) {
      const sessionCleanup = pruneGatewaySessionsOlderThan(ret.gatewaySessions)
      totalDeleted += sessionCleanup.deleted
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

/** Sync live agent statuses from gateway session files into the DB */
async function syncAgentLiveStatuses(): Promise<number> {
  const liveStatuses = getAgentLiveStatuses()
  if (liveStatuses.size === 0) return 0

  const db = getDatabase()
  const agents = db.prepare('SELECT id, name, config FROM agents').all() as Array<{
    id: number; name: string; config: string | null
  }>

  const update = db.prepare('UPDATE agents SET status = ?, last_seen = ?, last_activity = ?, updated_at = ? WHERE id = ?')
  let refreshed = 0

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  db.transaction(() => {
    for (const agent of agents) {
      // Match by agent name or openclawId from config
      let openclawId: string | null = null
      if (agent.config) {
        try {
          const cfg = JSON.parse(agent.config)
          if (typeof cfg.openclawId === 'string' && cfg.openclawId.trim()) {
            openclawId = cfg.openclawId.trim()
          }
        } catch { /* ignore */ }
      }

      const candidates = [openclawId, agent.name].filter(Boolean).map(s => normalize(s!))
      let matched: { status: 'active' | 'idle' | 'offline'; lastActivity: number; channel: string } | undefined

      for (const [sessionAgent, info] of liveStatuses) {
        if (candidates.includes(normalize(sessionAgent))) {
          matched = info
          break
        }
      }

      if (!matched || matched.status === 'offline') continue

      const now = Math.floor(Date.now() / 1000)
      const activity = `Gateway session (${matched.channel || 'unknown'})`
      update.run(matched.status, now, activity, now, agent.id)
      refreshed++

      eventBus.broadcast('agent.status_changed', {
        id: agent.id,
        name: agent.name,
        status: matched.status,
        last_seen: now,
        last_activity: activity,
      })
    }
  })()

  return refreshed
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

  tasks.set('skill_sync', {
    name: 'Skill Sync',
    intervalMs: TICK_MS, // Every 60s — lightweight file stat checks
    lastRun: null,
    nextRun: now + 10_000, // First scan 10s after startup
    enabled: true,
    running: false,
  })

  tasks.set('local_agent_sync', {
    name: 'Local Agent Sync',
    intervalMs: TICK_MS, // Every 60s — lightweight dir scan
    lastRun: null,
    nextRun: now + 15_000, // First scan 15s after startup
    enabled: true,
    running: false,
  })

  tasks.set('gateway_agent_sync', {
    name: 'Gateway Agent Sync',
    intervalMs: TICK_MS, // Every 60s — re-read openclaw.json
    lastRun: null,
    nextRun: now + 20_000, // First scan 20s after startup (after local sync)
    enabled: true,
    running: false,
  })

  tasks.set('task_dispatch', {
    name: 'Task Dispatch',
    intervalMs: TICK_MS, // Every 60s — check for assigned tasks to dispatch
    lastRun: null,
    nextRun: now + 10_000, // First check 10s after startup
    enabled: true,
    running: false,
  })

  tasks.set('aegis_review', {
    name: 'Aegis Quality Review',
    intervalMs: TICK_MS, // Every 60s — check for tasks awaiting review
    lastRun: null,
    nextRun: now + 30_000, // First check 30s after startup (after dispatch)
    enabled: true,
    running: false,
  })

  tasks.set('recurring_task_spawn', {
    name: 'Recurring Task Spawn',
    intervalMs: TICK_MS, // Every 60s — check for recurring tasks due
    lastRun: null,
    nextRun: now + 20_000, // First check 20s after startup
    enabled: true,
    running: false,
  })

  tasks.set('stale_task_requeue', {
    name: 'Stale Task Requeue',
    intervalMs: TICK_MS, // Every 60s — check for stale in_progress tasks
    lastRun: null,
    nextRun: now + 25_000, // First check 25s after startup
    enabled: true,
    running: false,
  })

  // Start the tick loop
  tickInterval = setInterval(tick, TICK_MS)
  logger.info('Scheduler initialized - backup at ~3AM, cleanup at ~4AM, heartbeat every 5m, webhook/claude/skill/local-agent/gateway-agent sync every 60s')
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
      : id === 'skill_sync' ? 'general.skill_sync'
      : id === 'local_agent_sync' ? 'general.local_agent_sync'
      : id === 'gateway_agent_sync' ? 'general.gateway_agent_sync'
      : id === 'task_dispatch' ? 'general.task_dispatch'
      : id === 'aegis_review' ? 'general.aegis_review'
      : id === 'recurring_task_spawn' ? 'general.recurring_task_spawn'
      : id === 'stale_task_requeue' ? 'general.stale_task_requeue'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'stale_task_requeue'
    if (!isSettingEnabled(settingKey, defaultEnabled)) continue

    task.running = true
    try {
      const result = id === 'auto_backup' ? await runBackup()
        : id === 'agent_heartbeat' ? await runHeartbeatCheck()
        : id === 'webhook_retry' ? await processWebhookRetries()
        : id === 'claude_session_scan' ? await syncClaudeSessions()
        : id === 'skill_sync' ? await syncSkillsFromDisk()
        : id === 'local_agent_sync' ? await syncLocalAgents()
        : id === 'gateway_agent_sync' ? await syncAgentsFromConfig('scheduled').then(async r => {
            const refreshed = await syncAgentLiveStatuses()
            return { ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total | Live status: ${refreshed} refreshed` }
          })
        : id === 'task_dispatch' ? await autoRouteInboxTasks().then(async (routeResult) => {
            const dispatchResult = await dispatchAssignedTasks()
            const parts = [routeResult.message, dispatchResult.message].filter(m => m && !m.includes('No '))
            return { ok: routeResult.ok && dispatchResult.ok, message: parts.join(' | ') || 'No tasks to route or dispatch' }
          })
        : id === 'aegis_review' ? await runAegisReviews()
        : id === 'recurring_task_spawn' ? await spawnRecurringTasks()
        : id === 'stale_task_requeue' ? await requeueStaleTasks()
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
      : id === 'skill_sync' ? 'general.skill_sync'
      : id === 'local_agent_sync' ? 'general.local_agent_sync'
      : id === 'gateway_agent_sync' ? 'general.gateway_agent_sync'
      : id === 'task_dispatch' ? 'general.task_dispatch'
      : id === 'aegis_review' ? 'general.aegis_review'
      : id === 'recurring_task_spawn' ? 'general.recurring_task_spawn'
      : id === 'stale_task_requeue' ? 'general.stale_task_requeue'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'stale_task_requeue'
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
  if (taskId === 'webhook_retry') return processWebhookRetries()
  if (taskId === 'claude_session_scan') return syncClaudeSessions()
  if (taskId === 'skill_sync') return syncSkillsFromDisk()
  if (taskId === 'local_agent_sync') return syncLocalAgents()
  if (taskId === 'gateway_agent_sync') return syncAgentsFromConfig('manual').then(r => ({ ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total` }))
  if (taskId === 'task_dispatch') return autoRouteInboxTasks().then(async (r) => { const d = await dispatchAssignedTasks(); return { ok: r.ok && d.ok, message: [r.message, d.message].filter(m => m && !m.includes('No ')).join(' | ') || 'No tasks' } })
  if (taskId === 'aegis_review') return runAegisReviews()
  if (taskId === 'recurring_task_spawn') return spawnRecurringTasks()
  if (taskId === 'stale_task_requeue') return requeueStaleTasks()
  return { ok: false, message: `Unknown task: ${taskId}` }
}

/** Stop the scheduler */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}
