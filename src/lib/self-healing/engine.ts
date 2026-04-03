/**
 * Self-Healing Engine: orchestrates circuit breakers, health checks,
 * auto-recovery, graceful degradation, and error taxonomy.
 *
 * Exports a singleton that can be imported by other modules.
 */

import { logger } from '../logger'
import {
  runHealthChecks,
  getLatestHealthChecks,
  startHealthPulse,
  stopHealthPulse,
  pruneHealthChecks,
} from './health-pulse'
import {
  isCircuitAllowed,
  recordSuccess,
  recordFailure,
  resetBreaker,
  getBreakerState,
  getAllBreakerStates,
} from './circuit-breaker'
import {
  attemptRecovery,
  getRecentRecoveryLogs,
  getServiceRecoveryLogs,
  registerRecoveryStrategy,
} from './auto-recovery'
import {
  markDegraded,
  markRecovered,
  isDegraded,
  getDegradedServices,
  getDegradedServiceNames,
  computeOverallHealth,
  withFallback,
} from './graceful-degradation'
import { classifyError, safeErrorMessage } from './error-taxonomy'
import type {
  SystemHealthSummary,
  HealthCheckResult,
  RecoveryAction,
  CircuitBreakerConfig,
  HealthPulseConfig,
} from './types'

interface SelfHealingEngine {
  // Lifecycle
  readonly start: (pulseConfig?: HealthPulseConfig) => void
  readonly stop: () => void

  // Health checks
  readonly checkHealth: () => ReadonlyArray<HealthCheckResult>
  readonly getHealthSummary: () => SystemHealthSummary
  readonly pruneOldChecks: (maxAgeSeconds?: number) => number

  // Circuit breakers
  readonly isAllowed: (serviceName: string, config?: CircuitBreakerConfig) => boolean
  readonly onSuccess: (serviceName: string) => void
  readonly onFailure: (serviceName: string, config?: CircuitBreakerConfig) => void
  readonly resetCircuit: (serviceName: string) => void
  readonly getCircuitStates: () => ReturnType<typeof getAllBreakerStates>

  // Recovery
  readonly recover: (serviceName: string, error: unknown) => RecoveryAction
  readonly getRecoveryLogs: (limit?: number) => ReturnType<typeof getRecentRecoveryLogs>
  readonly registerStrategy: typeof registerRecoveryStrategy

  // Degradation
  readonly degrade: (serviceName: string, reason: string) => void
  readonly restore: (serviceName: string) => void
  readonly isDegraded: (serviceName: string) => boolean
  readonly getDegraded: () => ReturnType<typeof getDegradedServiceNames>
  readonly withFallback: typeof withFallback

  // Error classification
  readonly classifyError: typeof classifyError
  readonly safeErrorMessage: typeof safeErrorMessage

  // Protected operation wrapper
  readonly protect: <T>(
    serviceName: string,
    operation: () => T,
    fallback?: () => T
  ) => T
}

function buildHealthSummary(): SystemHealthSummary {
  const services = getLatestHealthChecks()
  const circuitBreakers = getAllBreakerStates()
  const recentRecoveries = getRecentRecoveryLogs(10)
  const degradedServiceNames = getDegradedServiceNames()

  const statuses = services.map((s) => s.status)
  const overall = computeOverallHealth(statuses)

  return Object.freeze({
    overall,
    services,
    circuitBreakers,
    recentRecoveries,
    degradedServices: degradedServiceNames,
    timestamp: Math.floor(Date.now() / 1000),
  })
}

/**
 * Wrap an operation with circuit breaker + auto-recovery + graceful degradation.
 * This is the primary integration point for other modules.
 */
function protectOperation<T>(
  serviceName: string,
  operation: () => T,
  fallback?: () => T
): T {
  if (!isCircuitAllowed(serviceName)) {
    if (fallback) {
      markDegraded(serviceName, 'Circuit breaker open')
      return fallback()
    }
    throw new Error(`Service ${serviceName} is unavailable (circuit open)`)
  }

  if (fallback && isDegraded(serviceName)) {
    return withFallback(serviceName, operation, fallback)
  }

  try {
    const result = operation()
    recordSuccess(serviceName)

    if (isDegraded(serviceName)) {
      markRecovered(serviceName)
    }

    return result
  } catch (error) {
    recordFailure(serviceName)
    attemptRecovery(serviceName, error)

    if (fallback) {
      markDegraded(serviceName, error instanceof Error ? error.message : String(error))
      return fallback()
    }

    throw error
  }
}

function createEngine(): SelfHealingEngine {
  return Object.freeze({
    start: (pulseConfig?: HealthPulseConfig) => {
      logger.info('Self-healing engine starting')
      startHealthPulse(pulseConfig)
    },
    stop: () => {
      logger.info('Self-healing engine stopping')
      stopHealthPulse()
    },
    checkHealth: () => runHealthChecks(),
    getHealthSummary: buildHealthSummary,
    pruneOldChecks: pruneHealthChecks,
    isAllowed: isCircuitAllowed,
    onSuccess: recordSuccess,
    onFailure: recordFailure,
    resetCircuit: (serviceName: string) => { resetBreaker(serviceName) },
    getCircuitStates: getAllBreakerStates,
    recover: attemptRecovery,
    getRecoveryLogs: getRecentRecoveryLogs,
    registerStrategy: registerRecoveryStrategy,
    degrade: (serviceName: string, reason: string) => { markDegraded(serviceName, reason) },
    restore: (serviceName: string) => { markRecovered(serviceName) },
    isDegraded,
    getDegraded: getDegradedServiceNames,
    withFallback,
    classifyError,
    safeErrorMessage,
    protect: protectOperation,
  })
}

export const selfHealingEngine: SelfHealingEngine = createEngine()
