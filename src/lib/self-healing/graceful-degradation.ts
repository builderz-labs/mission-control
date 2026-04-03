/**
 * Graceful Degradation: when a subsystem fails, continue with reduced capability.
 * Tracks which services are currently degraded and provides fallback behavior.
 */

import { logger } from '../logger'
import { eventBus } from '../event-bus'
import type { HealthStatus } from './types'

interface DegradedService {
  readonly serviceName: string
  readonly reason: string
  readonly degradedAt: number
  readonly fallbackActive: boolean
}

// Immutable snapshot of degraded services state
let degradedServices: ReadonlyArray<DegradedService> = Object.freeze([])

/**
 * Mark a service as degraded with a reason.
 * Returns the new immutable list of degraded services.
 */
export function markDegraded(
  serviceName: string,
  reason: string
): ReadonlyArray<DegradedService> {
  const existing = degradedServices.find((s) => s.serviceName === serviceName)
  if (existing) {
    return degradedServices
  }

  const entry: DegradedService = Object.freeze({
    serviceName,
    reason,
    degradedAt: Math.floor(Date.now() / 1000),
    fallbackActive: true,
  })

  degradedServices = Object.freeze([...degradedServices, entry])

  logger.warn(
    { service: serviceName, reason },
    'Service marked as degraded -- fallback active'
  )

  broadcastDegradationEvent(serviceName, 'degraded', reason)

  return degradedServices
}

/**
 * Mark a service as recovered (no longer degraded).
 * Returns the new immutable list of degraded services.
 */
export function markRecovered(
  serviceName: string
): ReadonlyArray<DegradedService> {
  const existed = degradedServices.some((s) => s.serviceName === serviceName)
  if (!existed) {
    return degradedServices
  }

  degradedServices = Object.freeze(
    degradedServices.filter((s) => s.serviceName !== serviceName)
  )

  logger.info(
    { service: serviceName },
    'Service recovered from degraded state'
  )

  broadcastDegradationEvent(serviceName, 'recovered', 'Service restored')

  return degradedServices
}

/**
 * Check if a specific service is currently degraded.
 */
export function isDegraded(serviceName: string): boolean {
  return degradedServices.some((s) => s.serviceName === serviceName)
}

/**
 * Get all currently degraded services.
 */
export function getDegradedServices(): ReadonlyArray<DegradedService> {
  return degradedServices
}

/**
 * Get the names of all currently degraded services.
 */
export function getDegradedServiceNames(): ReadonlyArray<string> {
  return Object.freeze(degradedServices.map((s) => s.serviceName))
}

/**
 * Compute overall system health from individual service statuses.
 */
export function computeOverallHealth(
  statuses: ReadonlyArray<HealthStatus>
): HealthStatus {
  if (statuses.length === 0) return 'healthy'
  if (statuses.some((s) => s === 'down')) return 'down'
  if (statuses.some((s) => s === 'degraded')) return 'degraded'
  return 'healthy'
}

/**
 * Execute an operation with a fallback if the service is degraded.
 * Returns the result of the primary or fallback operation.
 */
export function withFallback<T>(
  serviceName: string,
  primary: () => T,
  fallback: () => T
): T {
  if (isDegraded(serviceName)) {
    logger.debug(
      { service: serviceName },
      'Using fallback due to degraded service'
    )
    return fallback()
  }

  try {
    return primary()
  } catch (error) {
    logger.warn(
      { err: error, service: serviceName },
      'Primary operation failed; using fallback'
    )
    markDegraded(
      serviceName,
      error instanceof Error ? error.message : String(error)
    )
    return fallback()
  }
}

function broadcastDegradationEvent(
  serviceName: string,
  status: 'degraded' | 'recovered',
  reason: string
): void {
  try {
    eventBus.broadcast('activity.created', {
      type: 'self_healing_degradation',
      entity_type: 'service',
      entity_id: 0,
      actor: 'self-healing-engine',
      description: `${serviceName} ${status}: ${reason}`,
      data: {
        serviceName,
        status,
        reason,
        degradedCount: degradedServices.length,
      },
      created_at: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to broadcast degradation event')
  }
}
