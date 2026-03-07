import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import { existsSync, statSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { logger } from '@/lib/logger'
import { APP_VERSION } from '@/lib/version'

const INSECURE_PASSWORDS = new Set([
  'admin',
  'password',
  'change-me-on-first-login',
  'changeme',
  'testpass123',
])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [version, security, database, agents, sessions, gateway] = await Promise.all([
      getVersionInfo(),
      getSecurityInfo(),
      getDatabaseInfo(),
      getAgentInfo(),
      getSessionInfo(),
      getGatewayInfo(),
    ])

    return NextResponse.json({
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        processMemory: process.memoryUsage(),
        processUptime: process.uptime(),
        isDocker: existsSync('/.dockerenv'),
      },
      version,
      security,
      database,
      agents,
      sessions,
      gateway,
      retention: config.retention,
    })
  } catch (error) {
    logger.error({ err: error }, 'Diagnostics API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function getVersionInfo() {
  let openclaw: string | null = null
  try {
    const { stdout } = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    openclaw = stdout.trim()
  } catch {
    // openclaw not available
  }
  return { app: APP_VERSION, openclaw }
}

function getSecurityInfo() {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = []

  const apiKey = process.env.API_KEY || ''
  checks.push({
    name: 'API key configured',
    pass: Boolean(apiKey) && apiKey !== 'generate-a-random-key',
    detail: !apiKey ? 'API_KEY is not set' : apiKey === 'generate-a-random-key' ? 'API_KEY is default value' : 'API_KEY is set',
  })

  const authPass = process.env.AUTH_PASS || ''
  checks.push({
    name: 'Auth password secure',
    pass: Boolean(authPass) && !INSECURE_PASSWORDS.has(authPass),
    detail: !authPass ? 'AUTH_PASS is not set' : INSECURE_PASSWORDS.has(authPass) ? 'AUTH_PASS is a known insecure password' : 'AUTH_PASS is not a common default',
  })

  const allowedHosts = process.env.MC_ALLOWED_HOSTS || ''
  checks.push({
    name: 'Allowed hosts configured',
    pass: Boolean(allowedHosts.trim()),
    detail: allowedHosts.trim() ? 'MC_ALLOWED_HOSTS is configured' : 'MC_ALLOWED_HOSTS is not set',
  })

  const sameSite = process.env.MC_COOKIE_SAMESITE || ''
  checks.push({
    name: 'Cookie SameSite strict',
    pass: sameSite.toLowerCase() === 'strict',
    detail: sameSite ? `MC_COOKIE_SAMESITE is '${sameSite}'` : 'MC_COOKIE_SAMESITE is not set',
  })

  const hsts = process.env.MC_ENABLE_HSTS || ''
  checks.push({
    name: 'HSTS enabled',
    pass: hsts === '1',
    detail: hsts === '1' ? 'HSTS is enabled' : 'MC_ENABLE_HSTS is not set to 1',
  })

  const rateLimitDisabled = process.env.MC_DISABLE_RATE_LIMIT || ''
  checks.push({
    name: 'Rate limiting enabled',
    pass: !rateLimitDisabled,
    detail: rateLimitDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
  })

  const gwHost = config.gatewayHost
  checks.push({
    name: 'Gateway bound to localhost',
    pass: gwHost === '127.0.0.1' || gwHost === 'localhost',
    detail: `Gateway host is '${gwHost}'`,
  })

  const passing = checks.filter(c => c.pass).length
  const score = Math.round((passing / checks.length) * 100)

  return { score, checks }
}

function getDatabaseInfo() {
  try {
    const db = getDatabase()

    let sizeBytes = 0
    try {
      sizeBytes = statSync(config.dbPath).size
    } catch {
      // ignore
    }

    const journalRow = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string } | undefined
    const walMode = journalRow?.journal_mode === 'wal'

    let migrationVersion: string | null = null
    try {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      ).get() as { name?: string } | undefined
      if (row?.name) {
        const latest = db.prepare(
          'SELECT version FROM migrations ORDER BY rowid DESC LIMIT 1'
        ).get() as { version: string } | undefined
        migrationVersion = latest?.version ?? null
      }
    } catch {
      // migrations table may not exist
    }

    return { sizeBytes, walMode, migrationVersion }
  } catch (err) {
    logger.error({ err }, 'Diagnostics: database info error')
    return { sizeBytes: 0, walMode: false, migrationVersion: null }
  }
}

function getAgentInfo() {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT status, COUNT(*) as count FROM agents GROUP BY status'
    ).all() as Array<{ status: string; count: number }>

    const byStatus: Record<string, number> = {}
    let total = 0
    for (const row of rows) {
      byStatus[row.status] = row.count
      total += row.count
    }
    return { total, byStatus }
  } catch {
    return { total: 0, byStatus: {} }
  }
}

function getSessionInfo() {
  try {
    const db = getDatabase()
    const totalRow = db.prepare('SELECT COUNT(*) as c FROM claude_sessions').get() as { c: number } | undefined
    const activeRow = db.prepare(
      "SELECT COUNT(*) as c FROM claude_sessions WHERE is_active = 1"
    ).get() as { c: number } | undefined
    return { active: activeRow?.c ?? 0, total: totalRow?.c ?? 0 }
  } catch {
    return { active: 0, total: 0 }
  }
}

async function getGatewayInfo() {
  const host = config.gatewayHost
  const port = config.gatewayPort
  const configured = Boolean(host && port)

  let reachable = false
  if (configured) {
    reachable = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(1500)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.connect(port, host)
    })
  }

  return { configured, reachable, host, port }
}
