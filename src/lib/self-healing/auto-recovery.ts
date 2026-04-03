/**
 * Auto Recovery: on failure detection, diagnose -> attempt fix -> verify -> report.
 * Tracks recovery attempts and escalates when retries are exhausted.
 */

import { getDatabase } from '../db'
import { logger } from '../logger'
import { eventBus } from '../event-bus'
import { classifyError } from './error-taxonomy'
import { recordFailure, recordSuccess, isCircuitAllowed } from './circuit-breaker'
import type {
  RecoveryAction,
  RecoveryLogRecord,
  RecoveryResult,
  ErrorType,
  ErrorClass,
} from './types'

type RecoveryStrategy = (serviceName: string, error: unknown) => boolean

const MAX_RECOVERY_ATTEMPTS = 3

/**
 * Registry of recovery strategies per service.
 * Each strategy returns true if recovery succeeded.
 */
const recoveryStrategies: Map<string, RecoveryStrategy> = new Map()

/**
 * Register a recovery strategy for a service.
 */
export function registerRecoveryStrategy(
  serviceName: string,
  strategy: RecoveryStrategy
): void {
  recoveryStrategies.set(serviceName, strategy)
}

/**
 * Attempt automatic recovery for a failed service.
 * Returns an immutable RecoveryAction describing the outcome.
 */
export function attemptRecovery(
  serviceName: string,
  error: unknown
): RecoveryAction {
  const classification = classifyError(error)
  const recentAttempts = getRecentAttemptCount(serviceName)
  const attemptNumber = recentAttempts + 1

  logger.info(
    { service: serviceName, attempt: attemptNumber, errorType: classification.errorType },
    'Attempting auto-recovery'
  )

  if (!classification.retryable || attemptNumber > MAX_RECOVERY_ATTEMPTS) {
    return escalate(serviceName, error, classification.errorType, classification.errorClass, attemptNumber)
  }

  if (!isCircuitAllowed(serviceName)) {
    return escalate(serviceName, error, classification.errorType, classification.errorClass, attemptNumber)
  }

  const diagnosis = diagnose(serviceName, error)
  const result = executeRecovery(serviceName, error)
  const action = buildRecoveryAction(
    serviceName,
    diagnosis,
    result,
    attemptNumber,
    classification.errorType,
    classification.errorClass
  )

  persistRecoveryLog(action)
  broadcastRecoveryEvent(action)
  updateCircuitBreaker(serviceName, result)

  return action
}

/**
 * Build a diagnosis string for internal logging and DB storage.
 * SECURITY: Raw error messages are stored in the DB for admin debugging
 * but MUST be sanitized before exposing to non-admin API callers.
 */
function diagnose(serviceName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const classification = classifyError(error)

  return [
    `Service: ${serviceName}`,
    `Error: ${message}`,
    `Type: ${classification.errorType}`,
    `Class: ${classification.errorClass}`,
    `Retryable: ${classification.retryable}`,
  ].join(' | ')
}

/**
 * Sanitize a diagnosis string for non-admin callers by stripping
 * raw error messages that may leak internal details.
 */
export function sanitizeDiagnosis(diagnosis: string): string {
  // Remove the "Error: ..." segment, keep service/type/class/retryable
  return diagnosis.replace(/\s*\|\s*Error:\s*[^|]*/i, '')
}

function executeRecovery(
  serviceName: string,
  error: unknown
): RecoveryResult {
  const strategy = recoveryStrategies.get(serviceName)

  if (!strategy) {
    logger.warn(
      { service: serviceName },
      'No recovery strategy registered; attempting generic recovery'
    )
    return attemptGenericRecovery(serviceName)
  }

  try {
    const succeeded = strategy(serviceName, error)
    return succeeded ? 'recovered' : 'failed'
  } catch (recoveryError) {
    logger.error(
      { err: recoveryError, service: serviceName },
      'Recovery strategy threw an error'
    )
    return 'failed'
  }
}

function attemptGenericRecovery(serviceName: string): RecoveryResult {
  // Generic recovery: verify the service is reachable via a basic check
  if (serviceName === 'database') {
    return attemptDatabaseRecovery()
  }
  return 'failed'
}

function attemptDatabaseRecovery(): RecoveryResult {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined
    return row?.ok === 1 ? 'recovered' : 'failed'
  } catch {
    return 'failed'
  }
}

function escalate(
  serviceName: string,
  error: unknown,
  errorType: ErrorType,
  errorClass: ErrorClass,
  attemptNumber: number
): RecoveryAction {
  const message = error instanceof Error ? error.message : String(error)

  logger.error(
    { service: serviceName, attempt: attemptNumber },
    'Recovery escalated -- manual intervention required'
  )

  const action: RecoveryAction = Object.freeze({
    serviceName,
    diagnosis: `Escalated after ${attemptNumber} attempts | Service: ${serviceName} | Type: ${errorType} | Class: ${errorClass}`,
    actionTaken: 'Escalated to operator',
    result: 'escalated' as const,
    attemptNumber,
    errorType,
    errorClass,
  })

  persistRecoveryLog(action)
  broadcastRecoveryEvent(action)
  recordFailure(serviceName)

  return action
}

function buildRecoveryAction(
  serviceName: string,
  diagnosis: string,
  result: RecoveryResult,
  attemptNumber: number,
  errorType: ErrorType,
  errorClass: ErrorClass
): RecoveryAction {
  const actionTaken = result === 'recovered'
    ? 'Automatic recovery succeeded'
    : 'Automatic recovery failed'

  return Object.freeze({
    serviceName,
    diagnosis,
    actionTaken,
    result,
    attemptNumber,
    errorType,
    errorClass,
  })
}

function updateCircuitBreaker(
  serviceName: string,
  result: RecoveryResult
): void {
  if (result === 'recovered') {
    recordSuccess(serviceName)
  } else {
    recordFailure(serviceName)
  }
}

function persistRecoveryLog(action: RecoveryAction): void {
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO recovery_logs
        (service_name, error_type, error_class, diagnosis, action_taken, result, attempt_number)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      action.serviceName,
      action.errorType,
      action.errorClass,
      action.diagnosis,
      action.actionTaken,
      action.result,
      action.attemptNumber
    )
  } catch (error) {
    logger.error({ err: error }, 'Failed to persist recovery log')
  }
}

function broadcastRecoveryEvent(action: RecoveryAction): void {
  try {
    eventBus.broadcast('activity.created', {
      type: 'self_healing_recovery',
      entity_type: 'service',
      entity_id: 0,
      actor: 'self-healing-engine',
      description: `${action.result}: ${action.serviceName} - ${action.actionTaken}`,
      data: {
        serviceName: action.serviceName,
        result: action.result,
        attemptNumber: action.attemptNumber,
        errorType: action.errorType,
      },
      created_at: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to broadcast recovery event')
  }
}

function getRecentAttemptCount(serviceName: string): number {
  try {
    const db = getDatabase()
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM recovery_logs
      WHERE service_name = ? AND created_at >= ?
    `).get(serviceName, fiveMinutesAgo) as { count: number } | undefined
    return row?.count ?? 0
  } catch {
    return 0
  }
}

/**
 * Get recent recovery logs.
 */
export function getRecentRecoveryLogs(
  limit: number = 20
): ReadonlyArray<RecoveryLogRecord> {
  try {
    const db = getDatabase()
    return Object.freeze(
      db.prepare(
        'SELECT id, service_name, error_type, error_class, diagnosis, action_taken, result, attempt_number, workspace_id, created_at FROM recovery_logs ORDER BY created_at DESC LIMIT ?'
      ).all(limit) as RecoveryLogRecord[]
    )
  } catch (error) {
    logger.error({ err: error }, 'Failed to get recovery logs')
    return Object.freeze([])
  }
}

/**
 * Get recovery logs for a specific service.
 */
export function getServiceRecoveryLogs(
  serviceName: string,
  limit: number = 10
): ReadonlyArray<RecoveryLogRecord> {
  try {
    const db = getDatabase()
    return Object.freeze(
      db.prepare(
        'SELECT id, service_name, error_type, error_class, diagnosis, action_taken, result, attempt_number, workspace_id, created_at FROM recovery_logs WHERE service_name = ? ORDER BY created_at DESC LIMIT ?'
      ).all(serviceName, limit) as RecoveryLogRecord[]
    )
  } catch (error) {
    logger.error({ err: error }, 'Failed to get service recovery logs')
    return Object.freeze([])
  }
}
