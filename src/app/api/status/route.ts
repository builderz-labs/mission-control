import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import { statSync } from 'node:fs'
import os from 'node:os'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { MODEL_CATALOG } from '@/lib/models'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'
import {
  getMissionControlAgents,
  getMissionControlEvents,
  getMissionControlSnapshot,
  getMissionControlTasks,
} from '@/lib/mission-control-status'

function parseTasklistCsvRows(output: string): Array<{ pid: string; command: string }> {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"') && !line.startsWith('"Image Name"'))
    .map((line) => line.split(','))
    .map((parts) => ({
      command: (parts[0] || '').replace(/"/g, ''),
      pid: (parts[1] || '0').replace(/"/g, ''),
    }))
    .filter((row) => row.command.length > 0)
}

async function getWindowsProcessesByImageNames(imageNames: string[], timeoutMs = 1500) {
  const rows: Array<{ pid: string; command: string }> = []
  for (const imageName of imageNames) {
    try {
      const { stdout } = await runCommand(
        'tasklist',
        ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${imageName}`],
        { timeoutMs }
      )
      rows.push(...parseTasklistCsvRows(stdout))
    } catch {
      // Process inspection is best-effort on Windows.
    }
  }
  return rows
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus()
      return NextResponse.json(status)
    }

    if (action === 'dashboard') {
      const data = await getDashboardData()
      return NextResponse.json(data)
    }

    if (action === 'mission-control') {
      return NextResponse.json(getMissionControlSnapshot())
    }

    if (action === 'stream') {
      return createEventStreamResponse()
    }

    if (action === 'agents') {
      return NextResponse.json(getMissionControlAgents())
    }

    if (action === 'events') {
      const limit = Math.min(Number(searchParams.get('limit') || '60'), 200)
      return NextResponse.json({ events: getMissionControlEvents(limit) })
    }

    if (action === 'tasks') {
      const limit = Math.min(Number(searchParams.get('limit') || '100'), 100)
      return NextResponse.json({ tasks: getMissionControlTasks(limit) })
    }

    if (action === 'agent-comms') {
      return NextResponse.json(getAgentCommsData(searchParams))
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

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function createEventStreamResponse() {
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', data: null, timestamp: Date.now() })}\n\n`)
      )

      const handler = (event: { type: string; data: unknown; timestamp: number }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Client disconnects are handled in cancel().
        }
      }

      eventBus.on('server-event', handler)

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      cleanup = () => {
        eventBus.off('server-event', handler)
        clearInterval(heartbeat)
      }
    },

    cancel() {
      if (cleanup) cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Aggregate all dashboard data in a single request.
 * Combines system health, DB stats, audit summary, and recent activity.
 */
async function getDashboardData() {
  const [system, dbStats] = await Promise.all([
    getSystemStatus(),
    getDbStats(),
  ])

  return { ...system, db: dbStats }
}

function getAgentCommsData(searchParams: URLSearchParams) {
  const db = getDatabase()
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)
  const since = searchParams.get('since')
  const agent = searchParams.get('agent')
  const humanNames = ['human', 'system', 'operator']
  const humanPlaceholders = humanNames.map(() => '?').join(',')

  let messagesQuery = `
    SELECT * FROM messages
    WHERE to_agent IS NOT NULL
      AND from_agent NOT IN (${humanPlaceholders})
      AND to_agent NOT IN (${humanPlaceholders})
  `
  const messagesParams: Array<string | number> = [...humanNames, ...humanNames]

  if (since) {
    messagesQuery += ' AND created_at > ?'
    messagesParams.push(parseInt(since, 10))
  }
  if (agent) {
    messagesQuery += ' AND (from_agent = ? OR to_agent = ?)'
    messagesParams.push(agent, agent)
  }

  messagesQuery += ' ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?'
  messagesParams.push(limit, offset)

  const messages = db.prepare(messagesQuery).all(...messagesParams) as Array<{
    id: number
    conversation_id: string
    from_agent: string
    to_agent: string | null
    content: string
    message_type: string
    metadata: string | null
    read_at: number | null
    created_at: number
  }>

  let graphQuery = `
    SELECT
      from_agent, to_agent,
      COUNT(*) as message_count,
      MAX(created_at) as last_message_at
    FROM messages
    WHERE to_agent IS NOT NULL
      AND from_agent NOT IN (${humanPlaceholders})
      AND to_agent NOT IN (${humanPlaceholders})
  `
  const graphParams: Array<string | number> = [...humanNames, ...humanNames]

  if (since) {
    graphQuery += ' AND created_at > ?'
    graphParams.push(parseInt(since, 10))
  }
  if (agent) {
    graphQuery += ' AND (from_agent = ? OR to_agent = ?)'
    graphParams.push(agent, agent)
  }

  graphQuery += ' GROUP BY from_agent, to_agent ORDER BY message_count DESC'
  const edges = db.prepare(graphQuery).all(...graphParams)

  let statsQuery = `
    SELECT agent, SUM(sent) as sent, SUM(received) as received FROM (
      SELECT from_agent as agent, COUNT(*) as sent, 0 as received
      FROM messages WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
  `
  const statsParams: Array<string | number> = [...humanNames, ...humanNames]
  if (since) {
    statsQuery += ' AND created_at > ?'
    statsParams.push(parseInt(since, 10))
  }
  if (agent) {
    statsQuery += ' AND (from_agent = ? OR to_agent = ?)'
    statsParams.push(agent, agent)
  }
  statsQuery += `
      GROUP BY from_agent
      UNION ALL
      SELECT to_agent as agent, 0 as sent, COUNT(*) as received
      FROM messages WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
  `
  statsParams.push(...humanNames, ...humanNames)
  if (since) {
    statsQuery += ' AND created_at > ?'
    statsParams.push(parseInt(since, 10))
  }
  if (agent) {
    statsQuery += ' AND (from_agent = ? OR to_agent = ?)'
    statsParams.push(agent, agent)
  }
  statsQuery += `
      GROUP BY to_agent
    ) GROUP BY agent ORDER BY (sent + received) DESC
  `
  const agentStats = db.prepare(statsQuery).all(...statsParams)

  let countQuery = `
    SELECT COUNT(*) as total FROM messages
    WHERE to_agent IS NOT NULL
      AND from_agent NOT IN (${humanPlaceholders})
      AND to_agent NOT IN (${humanPlaceholders})
  `
  const countParams: Array<string | number> = [...humanNames, ...humanNames]
  if (since) {
    countQuery += ' AND created_at > ?'
    countParams.push(parseInt(since, 10))
  }
  if (agent) {
    countQuery += ' AND (from_agent = ? OR to_agent = ?)'
    countParams.push(agent, agent)
  }
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number }

  let seededCountQuery = `
    SELECT COUNT(*) as seeded FROM messages
    WHERE to_agent IS NOT NULL
      AND from_agent NOT IN (${humanPlaceholders})
      AND to_agent NOT IN (${humanPlaceholders})
      AND conversation_id LIKE ?
  `
  const seededParams: Array<string | number> = [...humanNames, ...humanNames, 'conv-multi-%']
  if (since) {
    seededCountQuery += ' AND created_at > ?'
    seededParams.push(parseInt(since, 10))
  }
  if (agent) {
    seededCountQuery += ' AND (from_agent = ? OR to_agent = ?)'
    seededParams.push(agent, agent)
  }
  const { seeded } = db.prepare(seededCountQuery).get(...seededParams) as { seeded: number }

  const seededCount = seeded || 0
  const liveCount = Math.max(0, total - seededCount)
  const source =
    total === 0 ? 'empty' :
    liveCount === 0 ? 'seeded' :
    seededCount === 0 ? 'live' :
    'mixed'

  return {
    messages: messages.map((msg) => {
      let metadata: unknown = null
      if (msg.metadata) {
        try {
          metadata = JSON.parse(msg.metadata)
        } catch {
          metadata = null
        }
      }
      return {
        ...msg,
        metadata,
      }
    }),
    total,
    graph: { edges, agentStats },
    source: { mode: source, seededCount, liveCount },
  }
}

function getDbStats() {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const day = now - 86400
    const week = now - 7 * 86400

    // Task breakdown
    const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all() as Array<{ status: string; count: number }>
    const tasksByStatus: Record<string, number> = {}
    let totalTasks = 0
    for (const row of taskStats) {
      tasksByStatus[row.status] = row.count
      totalTasks += row.count
    }

    // Agent breakdown
    const agentStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM agents GROUP BY status
    `).all() as Array<{ status: string; count: number }>
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
    const activityDay = (db.prepare('SELECT COUNT(*) as c FROM activities WHERE created_at > ?').get(day) as any).c

    // Notifications (unread)
    const unreadNotifs = (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL').get() as any).c

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

async function getSystemStatus() {
  const status: any = {
    timestamp: Date.now(),
    uptime: os.uptime() * 1000,
    memory: {
      total: Math.round(os.totalmem() / (1024 * 1024)),
      used: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)),
      available: Math.round(os.freemem() / (1024 * 1024))
    },
    disk: { total: '0', used: '0', available: '0', usage: '0%' },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    // Disk info
    if (process.platform !== 'win32') {
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
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting disk info')
  }

  try {
    // ClawdBot processes
    if (process.platform !== 'win32') {
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
    } else {
      // Filtered calls avoid large, slow tasklist output on busy Windows hosts.
      status.processes = await getWindowsProcessesByImageNames(
        ['openclaw.exe', 'clawdbot.exe', 'openclaw-gateway.exe', 'clawdbot-gateway.exe'],
        1200
      )
    }
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
         WHERE LOWER(name) = LOWER(?)
            OR LOWER(REPLACE(name, ' ', '-')) = LOWER(?)`
      )
      for (const [agentName, info] of liveStatuses) {
        updateStmt.run(
          info.status,
          Math.floor(info.lastActivity / 1000),
          now,
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
    if (process.platform !== 'win32') {
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
    } else {
      const gatewayRows = await getWindowsProcessesByImageNames(
        ['clawdbot-gateway.exe', 'openclaw-gateway.exe'],
        1200
      )
      const match = gatewayRows.find(
        (row) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(row.command)
      )
      if (match) {
        gatewayStatus.running = true
        gatewayStatus.pid = match.pid
      }
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

  // Check disk space
  try {
    if (process.platform !== 'win32') {
      const { stdout } = await runCommand('df', ['/', '--output=pcent'], {
        timeoutMs: 3000
      })
      const lines = stdout.trim().split('\n')
      const last = lines[lines.length - 1] || ''
      const usagePercent = parseInt(last.replace('%', '').trim() || '0')
      
      health.checks.push({
        name: 'Disk Space',
        status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
        message: `Disk usage: ${usagePercent}%`
      })
    } else {
      // Basic check for Windows or just report healthy if we can't easily check
      health.checks.push({
        name: 'Disk Space',
        status: 'healthy',
        message: 'Disk monitoring not available on Windows'
      })
    }
  } catch (error) {
    health.checks.push({
      name: 'Disk Space',
      status: 'error',
      message: 'Failed to check disk space'
    })
  }

  // Check memory usage
  try {
    const total = os.totalmem()
    const available = os.freemem()
    const used = total - available
    const usagePercent = Math.round((used / total) * 100)

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
