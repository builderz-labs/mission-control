/**
 * Health Pulse: periodic health checks for critical subsystems.
 * Checks database connectivity, disk space, and memory usage.
 * Stores results in the health_checks table.
 */

import { existsSync, statfsSync } from 'node:fs'
import { getDatabase } from '../db'
import { logger } from '../logger'
import { config } from '../config'
import type {
  HealthCheckResult,
  HealthPulseConfig,
  HealthStatus,
} from './types'

const DEFAULT_PULSE_CONFIG: HealthPulseConfig = Object.freeze({
  intervalMs: 60_000, // 60 seconds
  services: ['database', 'disk', 'memory'],
})

const MEMORY_WARN_THRESHOLD = 0.85
const MEMORY_CRITICAL_THRESHOLD = 0.95
const DISK_WARN_THRESHOLD = 0.85
const DISK_CRITICAL_THRESHOLD = 0.95

let pulseInterval: ReturnType<typeof setInterval> | null = null

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Check database connectivity and response time.
 */
function checkDatabase(): HealthCheckResult {
  const start = Date.now()
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined
    const elapsed = Date.now() - start

    if (!row || row.ok !== 1) {
      return buildResult('database', 'down', elapsed, 'Database query returned unexpected result')
    }

    const status: HealthStatus = elapsed > 1000 ? 'degraded' : 'healthy'
    return buildResult('database', status, elapsed, null, { responseOk: true })
  } catch (error) {
    const elapsed = Date.now() - start
    const message = error instanceof Error ? error.message : String(error)
    return buildResult('database', 'down', elapsed, message)
  }
}

/**
 * Check available disk space where the database lives.
 */
function checkDisk(): HealthCheckResult {
  const start = Date.now()
  try {
    const dbPath = config.dbPath
    const dirPath = existsSync(dbPath) ? dbPath : process.cwd()

    const stats = statfsSync(dirPath)
    const totalBytes = stats.blocks * stats.bsize
    const freeBytes = stats.bfree * stats.bsize
    const usedRatio = 1 - (freeBytes / totalBytes)
    const elapsed = Date.now() - start

    const status = determineThresholdStatus(
      usedRatio,
      DISK_WARN_THRESHOLD,
      DISK_CRITICAL_THRESHOLD
    )

    return buildResult('disk', status, elapsed, null, {
      totalBytes,
      freeBytes,
      usedPercent: Math.round(usedRatio * 100),
    })
  } catch (error) {
    const elapsed = Date.now() - start
    const message = error instanceof Error ? error.message : String(error)
    return buildResult('disk', 'degraded', elapsed, message)
  }
}

/**
 * Check process memory usage against system limits.
 */
function checkMemory(): HealthCheckResult {
  const start = Date.now()
  try {
    const memUsage = process.memoryUsage()
    const heapUsedRatio = memUsage.heapUsed / memUsage.heapTotal
    const elapsed = Date.now() - start

    const status = determineThresholdStatus(
      heapUsedRatio,
      MEMORY_WARN_THRESHOLD,
      MEMORY_CRITICAL_THRESHOLD
    )

    return buildResult('memory', status, elapsed, null, {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
      usedPercent: Math.round(heapUsedRatio * 100),
    })
  } catch (error) {
    const elapsed = Date.now() - start
    const message = error instanceof Error ? error.message : String(error)
    return buildResult('memory', 'degraded', elapsed, message)
  }
}

function determineThresholdStatus(
  ratio: number,
  warnThreshold: number,
  criticalThreshold: number
): HealthStatus {
  if (ratio >= criticalThreshold) return 'down'
  if (ratio >= warnThreshold) return 'degraded'
  return 'healthy'
}

function buildResult(
  serviceName: string,
  status: HealthStatus,
  responseTimeMs: number,
  errorMessage: string | null,
  metadata: Record<string, unknown> | null = null
): HealthCheckResult {
  return Object.freeze({
    serviceName,
    status,
    responseTimeMs,
    errorMessage,
    metadata,
  })
}

const HEALTH_CHECKERS: Record<string, () => HealthCheckResult> = {
  database: checkDatabase,
  disk: checkDisk,
  memory: checkMemory,
}

/**
 * Run health checks for all registered services.
 * Returns immutable array of results.
 */
export function runHealthChecks(
  services: ReadonlyArray<string> = DEFAULT_PULSE_CONFIG.services
): ReadonlyArray<HealthCheckResult> {
  const results = services.map((service) => {
    const checker = HEALTH_CHECKERS[service]
    if (!checker) {
      return buildResult(service, 'degraded', 0, `No checker registered for service: ${service}`)
    }
    return checker()
  })

  persistHealthChecks(results)
  return Object.freeze(results)
}

function persistHealthChecks(
  results: ReadonlyArray<HealthCheckResult>
): void {
  try {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO health_checks (service_name, status, response_time_ms, error_message, metadata)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertAll = db.transaction((checks: ReadonlyArray<HealthCheckResult>) => {
      for (const check of checks) {
        stmt.run(
          check.serviceName,
          check.status,
          check.responseTimeMs,
          check.errorMessage,
          check.metadata ? JSON.stringify(check.metadata) : null
        )
      }
    })

    insertAll(results)
  } catch (error) {
    logger.error({ err: error }, 'Failed to persist health check results')
  }
}

/**
 * Get the most recent health check for each service.
 */
export function getLatestHealthChecks(): ReadonlyArray<HealthCheckResult> {
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT h.*
      FROM health_checks h
      INNER JOIN (
        SELECT service_name, MAX(id) as max_id
        FROM health_checks
        GROUP BY service_name
      ) latest ON h.id = latest.max_id
      ORDER BY h.service_name
    `).all() as Array<{
      service_name: string
      status: HealthStatus
      response_time_ms: number | null
      error_message: string | null
      metadata: string | null
    }>

    return Object.freeze(rows.map((row) => Object.freeze({
      serviceName: row.service_name,
      status: row.status,
      responseTimeMs: row.response_time_ms ?? 0,
      errorMessage: row.error_message,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    })))
  } catch (error) {
    logger.error({ err: error }, 'Failed to get latest health checks')
    return Object.freeze([])
  }
}

/**
 * Start the periodic health pulse.
 */
export function startHealthPulse(
  pulseConfig: HealthPulseConfig = DEFAULT_PULSE_CONFIG
): void {
  if (pulseInterval !== null) return

  logger.info(
    { intervalMs: pulseConfig.intervalMs },
    'Starting health pulse'
  )

  // Run an initial check immediately
  runHealthChecks(pulseConfig.services)

  pulseInterval = setInterval(() => {
    runHealthChecks(pulseConfig.services)
  }, pulseConfig.intervalMs)

  // Allow the process to exit even if the interval is active
  if (pulseInterval.unref) {
    pulseInterval.unref()
  }
}

/**
 * Stop the periodic health pulse.
 */
export function stopHealthPulse(): void {
  if (pulseInterval !== null) {
    clearInterval(pulseInterval)
    pulseInterval = null
    logger.info('Health pulse stopped')
  }
}

/**
 * Prune old health check records (keep last 24 hours by default).
 */
export function pruneHealthChecks(maxAgeSeconds: number = 86_400): number {
  try {
    const db = getDatabase()
    const cutoff = nowSeconds() - maxAgeSeconds
    const result = db.prepare(
      'DELETE FROM health_checks WHERE created_at < ?'
    ).run(cutoff)
    return result.changes
  } catch (error) {
    logger.error({ err: error }, 'Failed to prune health checks')
    return 0
  }
}
