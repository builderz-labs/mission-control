import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import os from 'node:os'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { MODEL_CATALOG } from '@/lib/models'
import { logger } from '@/lib/logger'
import { detectProviderSubscriptions, getPrimarySubscription } from '@/lib/provider-subscriptions'
import { APP_VERSION } from '@/lib/version'
import { isHermesInstalled, scanHermesSessions } from '@/lib/hermes-sessions'
import { registerMcAsDashboard } from '@/lib/gateway-runtime'

export async function GET(request: NextRequest) {
  // Docker/Kubernetes health probes must work without auth/cookies.
  const preAction = new URL(request.url).searchParams.get('action') || 'overview'
  if (preAction === 'health') {
    const health = await performHealthCheck()
    return NextResponse.json(health)
  }

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus(auth.user.workspace_id ?? 1)
      return NextResponse.json(status)
    }

    if (action === 'dashboard') {
      const data = await getDashboardData(auth.user.workspace_id ?? 1)
      return NextResponse.json(data)
    }

    if (action === 'gateway') {
      const gatewayStatus = await getGatewayStatus()
      return NextResponse.json(gatewayStatus)
    }

    if (action === 'models') {
      const models = await getAvailableModels()
      return NextResponse.json({ models })
    }

    if (action === 'health') {
      const health = await performHealthCheck()
      return NextResponse.json(health)
    }

    if (action === 'capabilities') {
      const capabilities = await getCapabilities(request)
      return NextResponse.json(capabilities)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Aggregate all dashboard data in a single request.
 * Combines system health, DB stats, audit summary, and recent activity.
 */
async function getDashboardData(workspaceId: number) {
  const [system, dbStats] = await Promise.all([
    getSystemStatus(workspaceId),
    getDbStats(workspaceId),
  ])

  return { ...system, db: dbStats }
}

async function getMemorySnapshot() {
  const totalBytes = os.totalmem()
  let availableBytes = os.freemem()

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('vm_stat', [], { timeoutMs: 3000 })
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i)
      const pageSize = parseInt(pageSizeMatch?.[1] || '4096', 10)
      const pageLabels = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable']

      const availablePages = pageLabels.reduce((sum, label) => {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = stdout.match(new RegExp(`${escapedLabel}:\\s+([\\d.]+)`, 'i'))
        const pages = parseInt((match?.[1] || '0').replace(/\./g, ''), 10)
        return sum + (Number.isFinite(pages) ? pages : 0)
      }, 0)

      const vmAvailableBytes = availablePages * pageSize
      if (vmAvailableBytes > 0) {
        availableBytes = Math.min(vmAvailableBytes, totalBytes)
      }
    } catch {
      // Fall back to os.freemem()
    }
  } else {
    try {
      const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 3000 })
      const memLine = stdout.split('\n').find((line) => line.startsWith('Mem:'))
      if (memLine) {
        const parts = memLine.trim().split(/\s+/)
        const available = parseInt(parts[6] || parts[3] || '0', 10)
        if (Number.isFinite(available) && available > 0) {
          availableBytes = Math.min(available, totalBytes)
        }
      }
    } catch {
      // Fall back to os.freemem()
    }
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes)
  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usagePercent,
  }
}

function getDbStats(workspaceId: number) {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const day = now - 86400
    const week = now - 7 * 86400

    // Task breakdown
    const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const tasksByStatus: Record<string, number> = {}
    let totalTasks = 0
    for (const row of taskStats) {
      tasksByStatus[row.status] = row.count
      totalTasks += row.count
    }

    // Agent breakdown
    const agentStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const agentsByStatus: Record<string, number> = {}
    let totalAgents = 0
    for (const row of agentStats) {
      agentsByStatus[row.status] = row.count
      totalAgents += row.count
    }

    // Audit events (24h / 7d)
    const auditDay = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(day) as any).c
    const auditWeek = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(week) as any).c

    // Security events (login failures in last 24h)
    const loginFailures = (db.prepare(
      "SELECT COUNT(*) as c FROM audit_log WHERE action = 'login_failed' AND created_at > ?"
    ).get(day) as any).c

    // Activities (24h)
    const activityDay = (
      db.prepare('SELECT COUNT(*) as c FROM activities WHERE created_at > ? AND workspace_id = ?').get(day, workspaceId) as any
    ).c

    // Notifications (unread)
    const unreadNotifs = (
      db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL AND workspace_id = ?').get(workspaceId) as any
    ).c

    // Pipeline runs (active + recent)
    let pipelineActive = 0
    let pipelineRecent = 0
    try {
      pipelineActive = (db.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE status = 'running'").get() as any).c
      pipelineRecent = (db.prepare('SELECT COUNT(*) as c FROM pipeline_runs WHERE created_at > ?').get(day) as any).c
    } catch {
      // Pipeline tables may not exist yet
    }

    // Latest backup
    let latestBackup: { name: string; size: number; age_hours: number } | null = null
    try {
      const { readdirSync } = require('fs')
      const { join, dirname } = require('path')
      const backupDir = join(dirname(config.dbPath), 'backups')
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(join(backupDir, f))
          return { name: f, size: stat.size, mtime: stat.mtimeMs }
        })
        .sort((a: any, b: any) => b.mtime - a.mtime)
      if (files.length > 0) {
        latestBackup = {
          name: files[0].name,
          size: files[0].size,
          age_hours: Math.round((Date.now() - files[0].mtime) / 3600000),
        }
      }
    } catch {
      // No backups dir
    }

    // DB file size
    let dbSizeBytes = 0
    try {
      dbSizeBytes = statSync(config.dbPath).size
    } catch {
      // ignore
    }

    // Webhook configs count
    let webhookCount = 0
    try {
      webhookCount = (db.prepare('SELECT COUNT(*) as c FROM webhooks').get() as any).c
    } catch {
      // table may not exist
    }

    return {
      tasks: { total: totalTasks, byStatus: tasksByStatus },
      agents: { total: totalAgents, byStatus: agentsByStatus },
      audit: { day: auditDay, week: auditWeek, loginFailures },
      activities: { day: activityDay },
      notifications: { unread: unreadNotifs },
      pipelines: { active: pipelineActive, recentDay: pipelineRecent },
      backup: latestBackup,
      dbSizeBytes,
      webhookCount,
    }
  } catch (err) {
    logger.error({ err }, 'getDbStats error')
    return null
  }
}

async function getSystemStatus(workspaceId: number) {
  const status: any = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    // System uptime (cross-platform)
    if (process.platform === 'darwin') {
      const { stdout } = await runCommand('sysctl', ['-n', 'kern.boottime'], {
        timeoutMs: 3000
      })
      // Output format: { sec = 1234567890, usec = 0 } ...
      const match = stdout.match(/sec\s*=\s*(\d+)/)
      if (match) {
        status.uptime = Date.now() - parseInt(match[1]) * 1000
      }
    } else {
      const { stdout } = await runCommand('uptime', ['-s'], {
        timeoutMs: 3000
      })
      const bootTime = new Date(stdout.trim())
      status.uptime = Date.now() - bootTime.getTime()
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting uptime')
  }

  try {
    // Memory info (cross-platform)
    const snapshot = await getMemorySnapshot()
    status.memory = {
      total: Math.round(snapshot.totalBytes / (1024 * 1024)),
      used: Math.round(snapshot.usedBytes / (1024 * 1024)),
      available: Math.round(snapshot.availableBytes / (1024 * 1024)),
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting memory info')
  }

  try {
    // Disk info
    const { stdout: diskOutput } = await runCommand('df', ['-h', '/'], {
      timeoutMs: 3000
    })
    const lastLine = diskOutput.trim().split('\n').pop() || ''
    const diskParts = lastLine.split(/\s+/)
    if (diskParts.length >= 4) {
      status.disk = {
        total: diskParts[1],
        used: diskParts[2],
        available: diskParts[3],
        usage: diskParts[4]
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting disk info')
  }

  try {
    // ClawdBot processes
    const { stdout: processOutput } = await runCommand(
      'ps',
      ['-A', '-o', 'pid,comm,args'],
      { timeoutMs: 3000 }
    )
    const processes = processOutput.split('\n')
      .filter(line => line.trim())
      .filter(line => !line.trim().toLowerCase().startsWith('pid '))
      .map(line => {
        const parts = line.trim().split(/\s+/)
        return {
          pid: parts[0],
          command: parts.slice(2).join(' ')
        }
      })
      .filter((proc) => /clawdbot|openclaw/i.test(proc.command))
    status.processes = processes
  } catch (error) {
    logger.error({ err: error }, 'Error getting process info')
  }

  try {
    // Read sessions directly from agent session stores on disk
    const gatewaySessions = getAllGatewaySessions()
    status.sessions = {
      total: gatewaySessions.length,
      active: gatewaySessions.filter((s) => s.active).length,
    }

    // Sync agent statuses in DB from live session data
    try {
      const db = getDatabase()
      const liveStatuses = getAgentLiveStatuses()
      const now = Math.floor(Date.now() / 1000)
      // Match by: exact name, lowercase, or normalized (spaces→hyphens)
      const updateStmt = db.prepare(
        `UPDATE agents SET status = ?, last_seen = ?, updated_at = ?
         WHERE workspace_id = ?
           AND (LOWER(name) = LOWER(?)
           OR LOWER(REPLACE(name, ' ', '-')) = LOWER(?))`
      )
      for (const [agentName, info] of liveStatuses) {
        updateStmt.run(
          info.status,
          Math.floor(info.lastActivity / 1000),
          now,
          workspaceId,
          agentName,
          agentName
        )
      }
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error syncing agent statuses')
    }
  } catch (error) {
    logger.error({ err: error }, 'Error reading session stores')
  }

  return status
}

async function getGatewayStatus() {
  const gatewayStatus: any = {
    running: false,
    port: config.gatewayPort,
    pid: null,
    uptime: 0,
    version: null,
    connections: 0
  }

  try {
    const { stdout } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], {
      timeoutMs: 3000
    })
    const match = stdout
      .split('\n')
      .find((line) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(line))
    if (match) {
      const parts = match.trim().split(/\s+/)
      gatewayStatus.running = true
      gatewayStatus.pid = parts[0]
    }
  } catch (error) {
    // Gateway not running
  }

  try {
    gatewayStatus.port_listening = await isPortOpen(config.gatewayHost, config.gatewayPort)
  } catch (error) {
    logger.error({ err: error }, 'Error checking port')
  }

  try {
    const { stdout } = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    gatewayStatus.version = stdout.trim()
  } catch (error) {
    try {
      const { stdout } = await runClawdbot(['--version'], { timeoutMs: 3000 })
      gatewayStatus.version = stdout.trim()
    } catch (innerError) {
      gatewayStatus.version = 'unknown'
    }
  }

  return gatewayStatus
}

async function getAvailableModels() {
  // This would typically query the gateway or config files
  // Model catalog is the single source of truth
  const models = [...MODEL_CATALOG]

  try {
    // Check which Ollama models are available locally
    const { stdout: ollamaOutput } = await runCommand('ollama', ['list'], {
      timeoutMs: 5000
    })
    const ollamaModels = ollamaOutput.split('\n')
      .slice(1) // Skip header
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/)
        return {
          alias: parts[0],
          name: `ollama/${parts[0]}`,
          provider: 'ollama',
          description: 'Local model',
          costPer1k: 0.0,
          size: parts[1] || 'unknown'
        }
      })

    // Add Ollama models that aren't already in the list
    ollamaModels.forEach(model => {
      if (!models.find(m => m.name === model.name)) {
        models.push(model)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Error checking Ollama models')
  }

  return models
}

async function performHealthCheck() {
  const health: any = {
    status: 'healthy',
    version: APP_VERSION,
    uptime: process.uptime(),
    checks: [],
    timestamp: Date.now()
  }

  // Check DB connectivity
  try {
    const db = getDatabase()
    const start = Date.now()
    db.prepare('SELECT 1').get()
    const elapsed = Date.now() - start

    let dbStatus: string
    if (elapsed > 1000) {
      dbStatus = 'warning'
    } else {
      dbStatus = 'healthy'
    }

    health.checks.push({
      name: 'Database',
      status: dbStatus,
      message: dbStatus === 'healthy' ? `DB reachable (${elapsed}ms)` : `DB slow (${elapsed}ms)`
    })
  } catch (error: any) {
    const isNativeModuleError = error?.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(error?.message || '')
    health.checks.push({
      name: 'Database',
      status: 'unhealthy',
      message: isNativeModuleError
        ? 'better-sqlite3 compiled for wrong Node.js version. Run: pnpm rebuild better-sqlite3'
        : 'DB connectivity failed'
    })
  }

  // Check process memory
  try {
    const mem = process.memoryUsage()
    const rssMB = Math.round(mem.rss / (1024 * 1024))
    let memStatus = 'healthy'
    if (mem.rss > 800 * 1024 * 1024) {
      memStatus = 'critical'
    } else if (mem.rss > 400 * 1024 * 1024) {
      memStatus = 'warning'
    }

    health.checks.push({
      name: 'Process Memory',
      status: memStatus,
      message: `RSS: ${rssMB}MB, Heap: ${Math.round(mem.heapUsed / (1024 * 1024))}/${Math.round(mem.heapTotal / (1024 * 1024))}MB`,
      detail: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      }
    })
  } catch (error) {
    health.checks.push({
      name: 'Process Memory',
      status: 'error',
      message: 'Failed to check process memory'
    })
  }

  // Check gateway connection
  try {
    const gatewayStatus = await getGatewayStatus()
    health.checks.push({
      name: 'Gateway',
      status: gatewayStatus.running ? 'healthy' : 'unhealthy',
      message: gatewayStatus.running ? 'Gateway is running' : 'Gateway is not running'
    })
  } catch (error) {
    health.checks.push({
      name: 'Gateway',
      status: 'error',
      message: 'Failed to check gateway status'
    })
  }

  // Check disk space (cross-platform: use df -h / and parse capacity column)
  try {
    const { stdout } = await runCommand('df', ['-h', '/'], {
      timeoutMs: 3000
    })
    const lines = stdout.trim().split('\n')
    const last = lines[lines.length - 1] || ''
    const parts = last.split(/\s+/)
    // On macOS capacity is col 4 ("85%"), on Linux use% is col 4 as well
    const pctField = parts.find(p => p.endsWith('%')) || '0%'
    const usagePercent = parseInt(pctField.replace('%', '') || '0')

    health.checks.push({
      name: 'Disk Space',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Disk usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Disk Space',
      status: 'error',
      message: 'Failed to check disk space'
    })
  }

  // Check memory usage (cross-platform)
  try {
    const usagePercent = (await getMemorySnapshot()).usagePercent

    health.checks.push({
      name: 'Memory Usage',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Memory usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Memory Usage',
      status: 'error',
      message: 'Failed to check memory usage'
    })
  }

  // Determine overall health
  const hasError = health.checks.some((check: any) => check.status === 'error')
  const hasCritical = health.checks.some((check: any) => check.status === 'critical')
  const hasWarning = health.checks.some((check: any) => check.status === 'warning')
  const hasDegraded = health.checks.some((check: any) =>
    check.name === 'Database' && check.status === 'warning'
  )

  if (hasError || hasCritical) {
    health.status = 'unhealthy'
  } else if (hasDegraded) {
    health.status = 'degraded'
  } else if (hasWarning) {
    health.status = 'warning'
  }

  return health
}

async function getCapabilities(request?: NextRequest) {
  // Probe configured gateways (if any) or fall back to the default port.
  // A DB row alone isn't enough — the gateway must actually be reachable.
  let gatewayReachable = false
  try {
    const db = getDatabase()
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gateways'"
    ).get() as { name?: string } | undefined
    if (table?.name) {
      const rows = db.prepare('SELECT host, port FROM gateways').all() as { host: string; port: number }[]
      if (rows.length > 0) {
        const probes = rows.map(r => isPortOpen(r.host, Number(r.port)))
        const results = await Promise.all(probes)
        gatewayReachable = results.some(Boolean)
      }
    }
  } catch {
    // ignore — fall through to default probe
  }

  const gateway = gatewayReachable || await isPortOpen(config.gatewayHost, config.gatewayPort)

  const openclawHome = Boolean(
    (config.openclawStateDir && existsSync(config.openclawStateDir)) ||
    (config.openclawConfigPath && existsSync(config.openclawConfigPath))
  )

  const claudeProjectsPath = path.join(config.claudeHome, 'projects')
  const claudeHome = existsSync(claudeProjectsPath)

  let claudeSessions = 0
  try {
    const db = getDatabase()
    const row = db.prepare(
      "SELECT COUNT(*) as c FROM claude_sessions WHERE is_active = 1"
    ).get() as { c: number } | undefined
    claudeSessions = row?.c ?? 0
  } catch {
    // claude_sessions table may not exist
  }

  const subscriptions = detectProviderSubscriptions().active
  const primary = getPrimarySubscription()
  const subscription = primary ? {
    type: primary.type,
    provider: primary.provider,
  } : null

  // Apply subscription overrides from settings
  try {
    const settingsDb = getDatabase()
    const planOverride = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.plan_override'").get() as { value: string } | undefined
    if (planOverride?.value && subscription) {
      subscription.type = planOverride.value
    }
    const codexPlan = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.codex_plan'").get() as { value: string } | undefined
    if (codexPlan?.value) {
      subscriptions['openai'] = { provider: 'openai', type: codexPlan.value, source: 'env' as const }
    }
  } catch {
    // settings table may not exist yet
  }

  const processUser = process.env.MC_DEFAULT_ORG_NAME || os.userInfo().username

  // Interface mode preference
  let interfaceMode = 'essential'
  try {
    const settingsDb = getDatabase()
    const modeRow = settingsDb.prepare("SELECT value FROM settings WHERE key = 'general.interface_mode'").get() as { value: string } | undefined
    if (modeRow?.value === 'full' || modeRow?.value === 'essential') {
      interfaceMode = modeRow.value
    }
  } catch {
    // settings table may not exist yet
  }

  const hermesInstalled = isHermesInstalled()
  let hermesSessions = 0
  if (hermesInstalled) {
    try {
      hermesSessions = scanHermesSessions(50).filter(s => s.isActive).length
    } catch { /* ignore */ }
  }

  // Auto-register MC as default dashboard when gateway + openclaw home detected
  let dashboardRegistration: { registered: boolean; alreadySet: boolean } | null = null
  if (gateway && openclawHome) {
    try {
      let mcUrl = process.env.MC_BASE_URL || ''
      if (!mcUrl && request) {
        const host = request.headers.get('host')
        const proto = request.headers.get('x-forwarded-proto') || 'http'
        if (host) mcUrl = `${proto}://${host}`
      }
      if (mcUrl) {
        dashboardRegistration = registerMcAsDashboard(mcUrl)
      }
    } catch (err) {
      logger.error({ err }, 'Dashboard registration failed')
    }
  }

  const isDocker = existsSync('/.dockerenv')

  return { gateway, openclawHome, claudeHome, claudeSessions, hermesInstalled, hermesSessions, subscription, subscriptions, processUser, interfaceMode, dashboardRegistration, isDocker }
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timeoutMs = 1500

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      cleanup()
      resolve(true)
    })

    socket.once('timeout', () => {
      cleanup()
      resolve(false)
    })

    socket.once('error', () => {
      cleanup()
      resolve(false)
    })

    socket.connect(port, host)
  })
}
