import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import os from 'node:os'
import { existsSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { MODEL_CATALOG } from '@/lib/models'
import { logger } from '@/lib/logger'
import { detectProviderSubscriptions, getPrimarySubscription } from '@/lib/provider-subscriptions'

export async function GET(request: NextRequest) {
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
      const capabilities = await getCapabilities()
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

async function getCpuInfo(): Promise<{ model: string; cores: number; loadAvg: { one: number; five: number; fifteen: number } }> {
  let model = 'Unknown'
  let cores = os.cpus().length
  let loadAvg = { one: 0, five: 0, fifteen: 0 }

  try {
    const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8')
    const match = cpuinfo.match(/model name\s*:\s*(.+)/)
    if (match) model = match[1].trim()
  } catch {}

  try {
    const loadline = readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/)
    loadAvg = {
      one: parseFloat(loadline[0]) || 0,
      five: parseFloat(loadline[1]) || 0,
      fifteen: parseFloat(loadline[2]) || 0,
    }
  } catch {}

  return { model, cores, loadAvg }
}

async function getTopProcesses(): Promise<Array<{ pid: string; name: string; cpu: number; mem: number; command: string }>> {
  try {
    const { stdout } = await runCommand('ps', ['aux', '--sort=-%cpu'], { timeoutMs: 4000 })
    const lines = stdout.trim().split('\n').slice(1) // skip header
    return lines.slice(0, 12).map(line => {
      const parts = line.trim().split(/\s+/)
      const pid = parts[1]
      const cpu = parseFloat(parts[2]) || 0
      const mem = parseFloat(parts[3]) || 0
      const command = parts.slice(10).join(' ')
      // Extract short process name from command
      const name = command.split('/').pop()?.split(' ')[0]?.substring(0, 32) || command.substring(0, 32)
      return { pid, name, cpu, mem, command: command.substring(0, 80) }
    }).filter(p => p.cpu > 0 || p.mem > 0)
  } catch {
    return []
  }
}

function getActiveSessionsByModel(): Record<string, number> {
  try {
    const sessions = getAllGatewaySessions(5 * 60 * 1000) // active in last 5 min
    const counts: Record<string, number> = {}
    for (const s of sessions) {
      if (!s.active || !s.model) continue
      const model = s.model.toLowerCase()
      counts[model] = (counts[model] || 0) + 1
    }
    return counts
  } catch {
    return {}
  }
}

async function getOllamaModels(): Promise<Array<{ name: string; size: string; processor: string; context: string; until: string }>> {
  try {
    const { stdout } = await runCommand('ollama', ['ps'], { timeoutMs: 5000 })
    const lines = stdout.trim().split('\n')
    if (lines.length < 2) return []
    // Parse header to find column positions
    const header = lines[0]
    const colStarts = ['NAME', 'ID', 'SIZE', 'PROCESSOR', 'CONTEXT', 'UNTIL'].map(col => header.indexOf(col))
    return lines.slice(1)
      .filter(l => l.trim())
      .map(line => {
        const get = (start: number, end: number) => (end > start ? line.slice(start, end) : line.slice(start)).trim()
        return {
          name: get(colStarts[0], colStarts[1]),
          size: get(colStarts[2], colStarts[3]),
          processor: get(colStarts[3], colStarts[4] > 0 ? colStarts[4] : colStarts[5]),
          context: colStarts[4] > 0 ? get(colStarts[4], colStarts[5]) : '',
          until: colStarts[5] > 0 ? get(colStarts[5], line.length) : '',
        }
      })
      .filter(m => m.name)
  } catch {
    return []
  }
}

async function getSystemStatus(workspaceId: number) {
  const status: any = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    cpu: 0,
    network: { inKBs: 0, outKBs: 0 },
    gpu: null,
    sessions: { total: 0, active: 0 },
    processes: [],
    cpuModel: '',
    cpuCores: 0,
    loadAvg: { one: 0, five: 0, fifteen: 0 },
    topProcesses: [] as any[],
    ollamaModels: [] as any[],
    activeSessionsByModel: {} as Record<string, number>,
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
    if (process.platform === 'darwin') {
      const totalBytes = os.totalmem()
      const freeBytes = os.freemem()
      const totalMB = Math.round(totalBytes / (1024 * 1024))
      const usedMB = Math.round((totalBytes - freeBytes) / (1024 * 1024))
      const availableMB = Math.round(freeBytes / (1024 * 1024))
      status.memory = { total: totalMB, used: usedMB, available: availableMB }
    } else {
      const { stdout: memOutput } = await runCommand('free', ['-m'], {
        timeoutMs: 3000
      })
      const memLine = memOutput.split('\n').find(line => line.startsWith('Mem:'))
      if (memLine) {
        const parts = memLine.split(/\s+/)
        status.memory = {
          total: parseInt(parts[1]) || 0,
          used: parseInt(parts[2]) || 0,
          available: parseInt(parts[6]) || 0
        }
      }
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
    const [cpuUsage, networkStats, gpuStats, cpuInfo, topProcesses, ollamaModels] = await Promise.all([
      getCpuUsage(),
      getNetworkStats(),
      getGpuStats(),
      getCpuInfo(),
      getTopProcesses(),
      getOllamaModels()
    ])
    status.cpu = cpuUsage
    status.network = networkStats
    status.gpu = gpuStats
    status.cpuModel = cpuInfo.model
    status.cpuCores = cpuInfo.cores
    status.loadAvg = cpuInfo.loadAvg
    status.topProcesses = topProcesses
    status.ollamaModels = ollamaModels
    status.activeSessionsByModel = getActiveSessionsByModel()
  } catch (error) {
    logger.error({ err: error }, 'Error getting CPU/network/GPU stats')
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

async function getCpuUsage(): Promise<number> {
  function parseStat() {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0]
    const nums = line.replace('cpu', '').trim().split(/\s+/).map(Number)
    const idle = nums[3] + nums[4]
    const total = nums.reduce((a, b) => a + b, 0)
    return { idle, total }
  }
  const s1 = parseStat()
  await new Promise(r => setTimeout(r, 200))
  const s2 = parseStat()
  const idleDiff = s2.idle - s1.idle
  const totalDiff = s2.total - s1.total
  return Math.round((1 - idleDiff / totalDiff) * 100)
}

async function getNetworkStats(): Promise<{ inKBs: number; outKBs: number }> {
  function parseNetDev() {
    const lines = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)
    let rxBytes = 0, txBytes = 0
    for (const line of lines) {
      if (!line.trim() || line.includes('lo:')) continue
      const parts = line.trim().split(/\s+/)
      rxBytes += parseInt(parts[1]) || 0
      txBytes += parseInt(parts[9]) || 0
    }
    return { rxBytes, txBytes }
  }
  const s1 = parseNetDev()
  await new Promise(r => setTimeout(r, 200))
  const s2 = parseNetDev()
  return {
    inKBs: Math.round((s2.rxBytes - s1.rxBytes) / 200),
    outKBs: Math.round((s2.txBytes - s1.txBytes) / 200)
  }
}

async function getGpuStats(): Promise<{
  name: string; utilization: number;
  memUsed: number; memTotal: number; temp: number
} | null> {
  try {
    const { stdout } = await runCommand(
      '/usr/lib/wsl/lib/nvidia-smi',
      ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
       '--format=csv,noheader,nounits'],
      { timeoutMs: 3000 }
    )
    const parts = stdout.trim().split(',').map((s: string) => s.trim())
    return {
      name: parts[0],
      utilization: parseInt(parts[1]),
      memUsed: parseInt(parts[2]),
      memTotal: parseInt(parts[3]),
      temp: parseInt(parts[4])
    }
  } catch {
    return null
  }
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
    overall: 'healthy',
    checks: [],
    timestamp: Date.now()
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
    let usagePercent: number
    if (process.platform === 'darwin') {
      const totalBytes = os.totalmem()
      const freeBytes = os.freemem()
      usagePercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
    } else {
      const { stdout } = await runCommand('free', ['-m'], { timeoutMs: 3000 })
      const memLine = stdout.split('\n').find((line) => line.startsWith('Mem:'))
      const parts = (memLine || '').split(/\s+/)
      const total = parseInt(parts[1] || '0')
      const available = parseInt(parts[6] || '0')
      usagePercent = Math.round(((total - available) / total) * 100)
    }

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

  if (hasError || hasCritical) {
    health.overall = 'unhealthy'
  } else if (hasWarning) {
    health.overall = 'warning'
  }

  return health
}

async function getCapabilities() {
  const gateway = await isPortOpen(config.gatewayHost, config.gatewayPort)

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

  return { gateway, openclawHome, claudeHome, claudeSessions, subscription, subscriptions }
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
