/**
 * Circuit Breaker for MC Task Dispatch
 *
 * Prevents retry storms that exhaust all model quotas:
 * 1. Per-task failure tracking with consecutive failure count
 * 2. Exponential backoff (30s → 60s → 120s → stop)
 * 3. Max retries per hour (hard cap)
 * 4. Cooldown period before allowing re-dispatch
 */

import { logger } from './logger'

interface FailureRecord {
  taskId: number
  consecutiveFailures: number
  lastFailureAt: number
  nextRetryAt: number
  totalRetriesThisHour: number
  hourWindowStart: number
  tripped: boolean  // circuit is open — stop dispatching
}

// Configuration
const MAX_CONSECUTIVE_FAILURES = 3
const MAX_RETRIES_PER_HOUR = 8
const BASE_BACKOFF_MS = 30_000       // 30s
const MAX_BACKOFF_MS = 300_000       // 5 min
const COOLDOWN_MS = 600_000          // 10 min after circuit trips
const HOUR_MS = 3_600_000

// In-memory failure tracking (reset on server restart)
const failures = new Map<number, FailureRecord>()

// Global dispatch rate limit
let globalDispatchCount = 0
let globalWindowStart = Date.now()
const GLOBAL_MAX_DISPATCHES_PER_HOUR = 30

function getOrCreate(taskId: number): FailureRecord {
  if (!failures.has(taskId)) {
    failures.set(taskId, {
      taskId,
      consecutiveFailures: 0,
      lastFailureAt: 0,
      nextRetryAt: 0,
      totalRetriesThisHour: 0,
      hourWindowStart: Date.now(),
      tripped: false,
    })
  }
  return failures.get(taskId)!
}

/**
 * Check if a task is allowed to be dispatched.
 * Returns { allowed: true } or { allowed: false, reason: string, retryAfterMs: number }
 */
export function canDispatch(taskId: number): { allowed: boolean; reason?: string; retryAfterMs?: number } {
  const now = Date.now()
  const record = getOrCreate(taskId)

  // Reset hour window if needed
  if (now - record.hourWindowStart > HOUR_MS) {
    record.totalRetriesThisHour = 0
    record.hourWindowStart = now
  }

  // Reset global window if needed
  if (now - globalWindowStart > HOUR_MS) {
    globalDispatchCount = 0
    globalWindowStart = now
  }

  // 1. Circuit is tripped — check cooldown
  if (record.tripped) {
    const cooldownEnd = record.lastFailureAt + COOLDOWN_MS
    if (now < cooldownEnd) {
      return {
        allowed: false,
        reason: `Circuit open: ${record.consecutiveFailures} consecutive failures. Cooldown until ${new Date(cooldownEnd).toISOString()}`,
        retryAfterMs: cooldownEnd - now,
      }
    }
    // Cooldown expired — allow one retry (half-open state)
    logger.info({ taskId }, 'Circuit breaker half-open: allowing retry after cooldown')
  }

  // 2. Backoff not yet elapsed
  if (record.nextRetryAt > now) {
    return {
      allowed: false,
      reason: `Backoff active: next retry at ${new Date(record.nextRetryAt).toISOString()}`,
      retryAfterMs: record.nextRetryAt - now,
    }
  }

  // 3. Max retries per hour exceeded
  if (record.totalRetriesThisHour >= MAX_RETRIES_PER_HOUR) {
    return {
      allowed: false,
      reason: `Max retries per hour (${MAX_RETRIES_PER_HOUR}) exceeded for task ${taskId}`,
      retryAfterMs: record.hourWindowStart + HOUR_MS - now,
    }
  }

  // 4. Global dispatch rate limit
  if (globalDispatchCount >= GLOBAL_MAX_DISPATCHES_PER_HOUR) {
    return {
      allowed: false,
      reason: `Global dispatch limit (${GLOBAL_MAX_DISPATCHES_PER_HOUR}/hour) reached`,
      retryAfterMs: globalWindowStart + HOUR_MS - now,
    }
  }

  return { allowed: true }
}

/**
 * Record a successful dispatch — reset failure tracking.
 */
export function recordSuccess(taskId: number): void {
  const record = getOrCreate(taskId)
  record.consecutiveFailures = 0
  record.tripped = false
  record.nextRetryAt = 0
  globalDispatchCount++
  logger.info({ taskId, globalDispatchCount }, 'Dispatch success — circuit closed')
}

/**
 * Record a dispatch failure — increment backoff.
 */
export function recordFailure(taskId: number, error?: string): void {
  const now = Date.now()
  const record = getOrCreate(taskId)

  record.consecutiveFailures++
  record.totalRetriesThisHour++
  record.lastFailureAt = now
  globalDispatchCount++

  // Exponential backoff: 30s, 60s, 120s, 240s, capped at 5min
  const backoffMs = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, record.consecutiveFailures - 1),
    MAX_BACKOFF_MS,
  )
  record.nextRetryAt = now + backoffMs

  // Trip circuit after MAX_CONSECUTIVE_FAILURES
  if (record.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    record.tripped = true
    logger.warn(
      { taskId, failures: record.consecutiveFailures, error },
      `Circuit TRIPPED for task ${taskId}: ${record.consecutiveFailures} consecutive failures. Cooldown ${COOLDOWN_MS / 1000}s.`
    )
  } else {
    logger.info(
      { taskId, failures: record.consecutiveFailures, backoffMs, error },
      `Dispatch failure ${record.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}. Backoff ${backoffMs / 1000}s.`
    )
  }
}

/**
 * Manually reset circuit for a task (e.g., from MC UI or API).
 */
export function resetCircuit(taskId: number): void {
  failures.delete(taskId)
  logger.info({ taskId }, 'Circuit manually reset')
}

/**
 * Get circuit breaker status for all tracked tasks.
 */
export function getCircuitStatus(): Array<{
  taskId: number
  consecutiveFailures: number
  tripped: boolean
  nextRetryAt: number | null
  totalRetriesThisHour: number
}> {
  const result: ReturnType<typeof getCircuitStatus> = []
  for (const [, record] of failures) {
    result.push({
      taskId: record.taskId,
      consecutiveFailures: record.consecutiveFailures,
      tripped: record.tripped,
      nextRetryAt: record.nextRetryAt || null,
      totalRetriesThisHour: record.totalRetriesThisHour,
    })
  }
  return result
}

/**
 * Get global dispatch stats.
 */
export function getGlobalStats(): {
  dispatchesThisHour: number
  maxPerHour: number
  windowResetsAt: number
} {
  return {
    dispatchesThisHour: globalDispatchCount,
    maxPerHour: GLOBAL_MAX_DISPATCHES_PER_HOUR,
    windowResetsAt: globalWindowStart + HOUR_MS,
  }
}
