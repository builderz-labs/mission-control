import path from 'node:path'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { NextRequest } from 'next/server'
import { getDatabase } from '@/lib/db'
import { config } from '@/lib/config'
import { runCommand } from '@/lib/command'
import { logger } from '@/lib/logger'
import { detectProviderSubscriptions, getPrimarySubscription } from '@/lib/provider-subscriptions'
import { APP_VERSION } from '@/lib/version'
import { isHermesInstalled, scanHermesSessions } from '@/lib/hermes-sessions'
import { registerMcAsDashboard } from '@/lib/gateway-runtime'
import { getMemorySnapshot } from './status-helpers'
import { getGatewayStatus, isPortOpen } from './gateway-helpers'

export interface HealthCheck {
  name: string
  status: string
  message: string
  detail?: Record<string, number>
}

export interface HealthReport {
  status: string
  version: string
  uptime: number
  checks: HealthCheck[]
  timestamp: number
}

export async function performHealthCheck(): Promise<HealthReport> {
  const health: HealthReport = {
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
    const dbStatus = elapsed > 1000 ? 'warning' : 'healthy'
    health.checks.push({
      name: 'Database',
      status: dbStatus,
      message: dbStatus === 'healthy' ? `DB reachable (${elapsed}ms)` : `DB slow (${elapsed}ms)`
    })
  } catch {
    health.checks.push({ name: 'Database', status: 'unhealthy', message: 'DB connectivity failed' })
  }

  // Check process memory
  try {
    const mem = process.memoryUsage()
    const rssMB = Math.round(mem.rss / (1024 * 1024))
    let memStatus = 'healthy'
    if (mem.rss > 800 * 1024 * 1024) memStatus = 'critical'
    else if (mem.rss > 400 * 1024 * 1024) memStatus = 'warning'

    health.checks.push({
      name: 'Process Memory',
      status: memStatus,
      message: `RSS: ${rssMB}MB, Heap: ${Math.round(mem.heapUsed / (1024 * 1024))}/${Math.round(mem.heapTotal / (1024 * 1024))}MB`,
      detail: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal }
    })
  } catch {
    health.checks.push({ name: 'Process Memory', status: 'error', message: 'Failed to check process memory' })
  }

  // Check gateway connection
  try {
    const gatewayStatus = await getGatewayStatus()
    health.checks.push({
      name: 'Gateway',
      status: gatewayStatus.running ? 'healthy' : 'unhealthy',
      message: gatewayStatus.running ? 'Gateway is running' : 'Gateway is not running'
    })
  } catch {
    health.checks.push({ name: 'Gateway', status: 'error', message: 'Failed to check gateway status' })
  }

  // Check disk space (cross-platform: use df -h / and parse capacity column)
  try {
    const { stdout } = await runCommand('df', ['-h', '/'], { timeoutMs: 3000 })
    const lines = stdout.trim().split('\n')
    const last = lines[lines.length - 1] || ''
    const parts = last.split(/\s+/)
    const pctField = parts.find(p => p.endsWith('%')) || '0%'
    const usagePercent = parseInt(pctField.replace('%', '') || '0')
    health.checks.push({
      name: 'Disk Space',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Disk usage: ${usagePercent}%`
    })
  } catch {
    health.checks.push({ name: 'Disk Space', status: 'error', message: 'Failed to check disk space' })
  }

  // Check memory usage (cross-platform)
  try {
    const usagePercent = (await getMemorySnapshot()).usagePercent
    health.checks.push({
      name: 'Memory Usage',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Memory usage: ${usagePercent}%`
    })
  } catch {
    health.checks.push({ name: 'Memory Usage', status: 'error', message: 'Failed to check memory usage' })
  }

  // Determine overall health
  const hasError = health.checks.some((c) => c.status === 'error')
  const hasCritical = health.checks.some((c) => c.status === 'critical')
  const hasWarning = health.checks.some((c) => c.status === 'warning')
  const hasDegraded = health.checks.some((c) => c.name === 'Database' && c.status === 'warning')

  if (hasError || hasCritical) health.status = 'unhealthy'
  else if (hasDegraded) health.status = 'degraded'
  else if (hasWarning) health.status = 'warning'

  return health
}

export async function getCapabilities(request?: NextRequest) {
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
        const results = await Promise.all(rows.map(r => isPortOpen(r.host, Number(r.port))))
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
  const subscription = primary ? { type: primary.type, provider: primary.provider } : null

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

  return { gateway, openclawHome, claudeHome, claudeSessions, hermesInstalled, hermesSessions, subscription, subscriptions, processUser, interfaceMode, dashboardRegistration }
}
