/**
 * Type definitions for the self-healing engine.
 * Shared across all self-healing modules.
 */

export type CircuitState = 'closed' | 'open' | 'half_open'

export type HealthStatus = 'healthy' | 'degraded' | 'down'

export type ErrorType = 'transient' | 'permanent'

export type ErrorClass = 'user_facing' | 'internal'

export type RecoveryResult = 'recovered' | 'failed' | 'escalated'

export interface CircuitBreakerRecord {
  readonly id: number
  readonly service_name: string
  readonly state: CircuitState
  readonly failure_count: number
  readonly last_failure_at: number | null
  readonly last_success_at: number | null
  readonly trip_count: number
  readonly cooldown_until: number | null
  readonly workspace_id: number
  readonly created_at: number
  readonly updated_at: number
}

export interface HealthCheckRecord {
  readonly id: number
  readonly service_name: string
  readonly status: HealthStatus
  readonly response_time_ms: number | null
  readonly error_message: string | null
  readonly metadata: string | null
  readonly workspace_id: number
  readonly created_at: number
}

export interface RecoveryLogRecord {
  readonly id: number
  readonly service_name: string
  readonly error_type: ErrorType | null
  readonly error_class: ErrorClass | null
  readonly diagnosis: string | null
  readonly action_taken: string | null
  readonly result: RecoveryResult | null
  readonly attempt_number: number
  readonly workspace_id: number
  readonly created_at: number
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number
  readonly windowMs: number
  readonly cooldownMs: number
}

export interface HealthPulseConfig {
  readonly intervalMs: number
  readonly services: ReadonlyArray<string>
}

export interface RecoveryAction {
  readonly serviceName: string
  readonly diagnosis: string
  readonly actionTaken: string
  readonly result: RecoveryResult
  readonly attemptNumber: number
  readonly errorType: ErrorType
  readonly errorClass: ErrorClass
}

export interface HealthCheckResult {
  readonly serviceName: string
  readonly status: HealthStatus
  readonly responseTimeMs: number
  readonly errorMessage: string | null
  readonly metadata: Record<string, unknown> | null
}

export interface SystemHealthSummary {
  readonly overall: HealthStatus
  readonly services: ReadonlyArray<HealthCheckResult>
  readonly circuitBreakers: ReadonlyArray<CircuitBreakerRecord>
  readonly recentRecoveries: ReadonlyArray<RecoveryLogRecord>
  readonly degradedServices: ReadonlyArray<string>
  readonly timestamp: number
}

export interface ErrorClassification {
  readonly errorType: ErrorType
  readonly errorClass: ErrorClass
  readonly retryable: boolean
  readonly maxRetries: number
}
