/**
 * Self-Healing Engine barrel export.
 * Import the singleton engine or individual modules as needed.
 */

export { selfHealingEngine } from './engine'

// Re-export types
export type {
  CircuitState,
  HealthStatus,
  ErrorType,
  ErrorClass,
  RecoveryResult,
  CircuitBreakerRecord,
  HealthCheckRecord,
  RecoveryLogRecord,
  CircuitBreakerConfig,
  HealthPulseConfig,
  RecoveryAction,
  HealthCheckResult,
  SystemHealthSummary,
  ErrorClassification,
} from './types'

// Re-export the migration for registration
export { selfHealingMigration } from './migration'

// Re-export individual modules for granular usage
export {
  classifyError,
  safeErrorMessage,
} from './error-taxonomy'

export {
  isCircuitAllowed,
  recordSuccess,
  recordFailure,
  resetBreaker,
  getBreakerState,
  getAllBreakerStates,
} from './circuit-breaker'

export {
  runHealthChecks,
  getLatestHealthChecks,
  startHealthPulse,
  stopHealthPulse,
  pruneHealthChecks,
} from './health-pulse'

export {
  attemptRecovery,
  getRecentRecoveryLogs,
  getServiceRecoveryLogs,
  registerRecoveryStrategy,
  sanitizeDiagnosis,
} from './auto-recovery'

export {
  markDegraded,
  markRecovered,
  isDegraded,
  getDegradedServices,
  getDegradedServiceNames,
  computeOverallHealth,
  withFallback,
} from './graceful-degradation'
