/**
 * Error Taxonomy: classifies errors as transient/permanent and user-facing/internal.
 * Routes recovery strategy based on classification.
 */

import type { ErrorClassification, ErrorClass, ErrorType } from './types'

const TRANSIENT_PATTERNS: ReadonlyArray<RegExp> = [
  /SQLITE_BUSY/i,
  /SQLITE_LOCKED/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /network/i,
  /timeout/i,
  /too many connections/i,
  /resource temporarily unavailable/i,
  /service unavailable/i,
  /rate limit/i,
  /throttl/i,
]

const PERMANENT_PATTERNS: ReadonlyArray<RegExp> = [
  /SQLITE_CORRUPT/i,
  /SQLITE_NOTADB/i,
  /SQLITE_CONSTRAINT/i,
  /permission denied/i,
  /EACCES/i,
  /ENOENT/i,
  /no such table/i,
  /syntax error/i,
  /invalid/i,
  /out of memory/i,
  /disk full/i,
  /ENOSPC/i,
]

const USER_FACING_PATTERNS: ReadonlyArray<RegExp> = [
  /authentication/i,
  /authorization/i,
  /forbidden/i,
  /not found/i,
  /validation/i,
  /bad request/i,
  /conflict/i,
  /rate limit/i,
]

function matchesAny(
  message: string,
  patterns: ReadonlyArray<RegExp>
): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

function classifyErrorType(message: string): ErrorType {
  if (matchesAny(message, TRANSIENT_PATTERNS)) {
    return 'transient'
  }
  if (matchesAny(message, PERMANENT_PATTERNS)) {
    return 'permanent'
  }
  return 'transient'
}

function classifyErrorClass(message: string): ErrorClass {
  if (matchesAny(message, USER_FACING_PATTERNS)) {
    return 'user_facing'
  }
  return 'internal'
}

function determineRetryPolicy(
  errorType: ErrorType
): { retryable: boolean; maxRetries: number } {
  if (errorType === 'transient') {
    return { retryable: true, maxRetries: 3 }
  }
  return { retryable: false, maxRetries: 0 }
}

/**
 * Classify an error to determine recovery strategy.
 * Returns an immutable classification object.
 */
export function classifyError(error: unknown): ErrorClassification {
  const message = error instanceof Error
    ? error.message
    : String(error)

  const errorType = classifyErrorType(message)
  const errorClass = classifyErrorClass(message)
  const retryPolicy = determineRetryPolicy(errorType)

  return Object.freeze({
    errorType,
    errorClass,
    retryable: retryPolicy.retryable,
    maxRetries: retryPolicy.maxRetries,
  })
}

/**
 * Extract a safe, non-leaking error message for user-facing responses.
 * Internal errors get a generic message; user-facing errors pass through.
 */
export function safeErrorMessage(
  error: unknown,
  classification: ErrorClassification
): string {
  if (classification.errorClass === 'user_facing') {
    return error instanceof Error ? error.message : String(error)
  }
  return 'An internal error occurred. The system is attempting automatic recovery.'
}
