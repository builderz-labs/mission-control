/**
 * Circuit Breaker: tracks failures per service and trips when threshold exceeded.
 * States: closed (normal) -> open (blocking) -> half_open (testing recovery).
 * Auto-resets after cooldown period.
 */

import { getDatabase } from '../db'
import { logger } from '../logger'
import type {
  CircuitBreakerConfig,
  CircuitBreakerRecord,
  CircuitState,
} from './types'

const DEFAULT_CONFIG: CircuitBreakerConfig = Object.freeze({
  failureThreshold: 3,
  windowMs: 5 * 60 * 1000,   // 5 minutes
  cooldownMs: 30 * 1000,      // 30 seconds
})

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function ensureBreakerExists(serviceName: string): void {
  const db = getDatabase()
  db.prepare(`
    INSERT OR IGNORE INTO circuit_breakers (service_name, state, failure_count)
    VALUES (?, 'closed', 0)
  `).run(serviceName)
}

/**
 * Get the current state of a circuit breaker for a service.
 * Returns null if no breaker exists.
 */
export function getBreakerState(serviceName: string): CircuitBreakerRecord | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT id, service_name, state, failure_count, last_failure_at, last_success_at, trip_count, cooldown_until, workspace_id, created_at, updated_at FROM circuit_breakers WHERE service_name = ?'
  ).get(serviceName) as CircuitBreakerRecord | undefined

  return row ?? null
}

/**
 * Get all circuit breaker states.
 */
export function getAllBreakerStates(): ReadonlyArray<CircuitBreakerRecord> {
  const db = getDatabase()
  return db.prepare(
    'SELECT id, service_name, state, failure_count, last_failure_at, last_success_at, trip_count, cooldown_until, workspace_id, created_at, updated_at FROM circuit_breakers ORDER BY service_name'
  ).all() as CircuitBreakerRecord[]
}

/**
 * Check if a circuit breaker allows requests through.
 * Automatically transitions open -> half_open after cooldown.
 */
export function isCircuitAllowed(
  serviceName: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): boolean {
  ensureBreakerExists(serviceName)
  const breaker = getBreakerState(serviceName)
  if (!breaker) return true

  if (breaker.state === 'closed') return true

  if (breaker.state === 'open') {
    return tryTransitionToHalfOpen(serviceName, breaker, config)
  }

  // half_open: allow one request through for testing
  return true
}

function tryTransitionToHalfOpen(
  serviceName: string,
  breaker: CircuitBreakerRecord,
  config: CircuitBreakerConfig
): boolean {
  const now = nowSeconds()
  const cooldownExpired = breaker.cooldown_until !== null
    && now >= breaker.cooldown_until

  if (!cooldownExpired) return false

  transitionState(serviceName, 'half_open')
  logger.info({ service: serviceName }, 'Circuit breaker transitioning to half_open')
  return true
}

/**
 * Record a successful operation. Resets breaker to closed.
 */
export function recordSuccess(serviceName: string): CircuitBreakerRecord {
  ensureBreakerExists(serviceName)
  const db = getDatabase()
  const now = nowSeconds()

  db.prepare(`
    UPDATE circuit_breakers
    SET state = 'closed', failure_count = 0,
        last_success_at = ?, updated_at = ?
    WHERE service_name = ?
  `).run(now, now, serviceName)

  const updated = getBreakerState(serviceName)
  if (!updated) {
    throw new Error(`Circuit breaker not found after success: ${serviceName}`)
  }

  return updated
}

/**
 * Record a failure. Trips breaker if threshold exceeded within window.
 */
export function recordFailure(
  serviceName: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): CircuitBreakerRecord {
  ensureBreakerExists(serviceName)
  const db = getDatabase()
  const now = nowSeconds()
  const breaker = getBreakerState(serviceName)!

  const windowStart = now - Math.floor(config.windowMs / 1000)
  const recentFailures = isWithinWindow(breaker, windowStart)
    ? breaker.failure_count + 1
    : 1

  db.prepare(`
    UPDATE circuit_breakers
    SET failure_count = ?, last_failure_at = ?, updated_at = ?
    WHERE service_name = ?
  `).run(recentFailures, now, now, serviceName)

  if (recentFailures >= config.failureThreshold) {
    return tripBreaker(serviceName, config)
  }

  return getBreakerState(serviceName)!
}

function isWithinWindow(
  breaker: CircuitBreakerRecord,
  windowStart: number
): boolean {
  return breaker.last_failure_at !== null
    && breaker.last_failure_at >= windowStart
}

function tripBreaker(
  serviceName: string,
  config: CircuitBreakerConfig
): CircuitBreakerRecord {
  const db = getDatabase()
  const now = nowSeconds()
  const cooldownUntil = now + Math.floor(config.cooldownMs / 1000)

  db.prepare(`
    UPDATE circuit_breakers
    SET state = 'open', cooldown_until = ?,
        trip_count = trip_count + 1, updated_at = ?
    WHERE service_name = ?
  `).run(cooldownUntil, now, serviceName)

  logger.warn(
    { service: serviceName, cooldownUntil },
    'Circuit breaker TRIPPED to open'
  )

  return getBreakerState(serviceName)!
}

function transitionState(
  serviceName: string,
  newState: CircuitState
): void {
  const db = getDatabase()
  const now = nowSeconds()

  db.prepare(`
    UPDATE circuit_breakers
    SET state = ?, updated_at = ?
    WHERE service_name = ?
  `).run(newState, now, serviceName)
}

/**
 * Manually reset a circuit breaker to closed state.
 */
export function resetBreaker(serviceName: string): CircuitBreakerRecord | null {
  ensureBreakerExists(serviceName)
  const db = getDatabase()
  const now = nowSeconds()

  db.prepare(`
    UPDATE circuit_breakers
    SET state = 'closed', failure_count = 0,
        cooldown_until = NULL, updated_at = ?
    WHERE service_name = ?
  `).run(now, serviceName)

  logger.info({ service: serviceName }, 'Circuit breaker manually reset')
  return getBreakerState(serviceName)
}
