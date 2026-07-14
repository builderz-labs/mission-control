/**
 * Pure utility functions extracted from the WebSocket module for testability.
 */

/**
 * Gateway protocol negotiation window. We advertise a [min, max] range in the
 * connect handshake so the gateway can pick the highest mutually-supported
 * version. OpenClaw 2026.5.18+ bumped its handshake to v4 (requires
 * maxProtocol >= 4 && minProtocol <= 4); older gateways still accept v3.
 * Advertising 3..4 satisfies both (issue #701). Bump `max` as support for newer
 * protocol revisions is added.
 */
export const SUPPORTED_PROTOCOL = { min: 3, max: 4 } as const

/** Build the {minProtocol, maxProtocol} pair sent in the connect handshake. */
export function buildProtocolNegotiation(): { minProtocol: number; maxProtocol: number } {
  return { minProtocol: SUPPORTED_PROTOCOL.min, maxProtocol: SUPPORTED_PROTOCOL.max }
}

/**
 * Whether our advertised protocol range can satisfy a gateway that requires a
 * specific version V (i.e. min <= V <= max). Mirrors the gateway-side check.
 */
export function protocolRangeSatisfies(requiredVersion: number): boolean {
  return SUPPORTED_PROTOCOL.min <= requiredVersion && requiredVersion <= SUPPORTED_PROTOCOL.max
}

/** Known gateway connect error detail codes (structured error codes sent by newer gateways) */
export const ConnectErrorDetailCodes = {
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_PASSWORD_MISSING: 'AUTH_PASSWORD_MISSING',
  AUTH_PASSWORD_MISMATCH: 'AUTH_PASSWORD_MISMATCH',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  DEVICE_SIGNATURE_INVALID: 'DEVICE_SIGNATURE_INVALID',
} as const

/** Error detail shape from gateway frames. */
export interface GatewayErrorDetail {
  message?: string
  code?: string
  details?: { code?: string; [key: string]: any }
  [key: string]: any
}

/** Extract structured error code from a gateway error frame, if present. */
export function readErrorDetailCode(error: GatewayErrorDetail | null | undefined): string | null {
  if (!error || typeof error !== 'object') return null
  // Newer gateways include a structured details object with a code field
  const detailsCode = error.details?.code
  if (typeof detailsCode === 'string' && detailsCode.length > 0) return detailsCode
  // Some frames carry code at the top level
  const topCode = error.code
  if (typeof topCode === 'string' && topCode.length > 0) return topCode
  return null
}

/** Error codes that should never trigger auto-reconnect. */
export const NON_RETRYABLE_ERROR_CODES = new Set<string>([
  ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
  ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
  ConnectErrorDetailCodes.ORIGIN_NOT_ALLOWED,
  ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID,
])

/** Check whether a given error code is non-retryable. */
export function isNonRetryableErrorCode(code: string): boolean {
  return NON_RETRYABLE_ERROR_CODES.has(code)
}

/**
 * Retry once without browser device identity when a valid gateway auth token
 * exists but the browser's cached device credentials appear invalid.
 */
export function shouldRetryWithoutDeviceIdentity(
  message: string,
  error: GatewayErrorDetail | null | undefined,
  hasAuthToken: boolean,
  alreadyRetried: boolean,
): boolean {
  if (!hasAuthToken || alreadyRetried) return false

  const code = readErrorDetailCode(error)
  if (code === ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID) return true

  const normalized = message.toLowerCase()
  return (
    normalized.includes('device_auth_signature_invalid') ||
    normalized.includes('device signature invalid') ||
    normalized.includes('invalid device token') ||
    normalized.includes('device token invalid')
  )
}

/**
 * Calculate exponential backoff delay for reconnect attempts.
 * Uses base * 1.7^attempt, capped at 15000ms.
 * Returns only the deterministic base (without jitter) for testability.
 */
export function calculateBackoff(attempt: number): number {
  return Math.min(1000 * Math.pow(1.7, attempt), 15000)
}

/**
 * Detect a gap in event sequence numbers.
 * Returns info about the gap, or null if there is no gap.
 */
export function detectSequenceGap(
  lastSeq: number | null,
  currentSeq: number,
): { from: number; to: number; count: number } | null {
  if (lastSeq === null) return null
  if (currentSeq <= lastSeq + 1) return null
  const from = lastSeq + 1
  const to = currentSeq - 1
  return { from, to, count: to - from + 1 }
}
