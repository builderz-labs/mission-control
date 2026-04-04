/**
 * Type-safe parameter for better-sqlite3 prepared statements.
 * Use this instead of `any[]` for all SQLite query parameters.
 */
export type SqlParam = string | number | bigint | boolean | null | Buffer

/**
 * Extracts a string message from an unknown caught error.
 * Prefer this over `(error as any).message`.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/**
 * Coerces an unknown caught value to an Error instance.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(getErrorMessage(err))
}

/**
 * Shape of errors thrown by Node.js child_process exec/spawn.
 * Provides typed access to stderr/stdout/code without `as any`.
 */
export interface ProcessError extends Error {
  code?: string | number
  stderr?: string
  stdout?: string
}
