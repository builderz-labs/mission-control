/**
 * Convenience re-export for `import { selfHealingEngine } from '@/lib/self-healing'`.
 * Delegates to the self-healing module directory.
 */
export {
  selfHealingEngine,
  selfHealingMigration,
} from './self-healing/index'

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
} from './self-healing/index'
