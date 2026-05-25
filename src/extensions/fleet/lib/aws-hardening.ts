/**
 * Shared AWS-call hardening primitives for the fleet handlers.
 *
 * Consolidates three cross-cutting concerns that were previously
 * either duplicated (the timeout helper lived only in
 * harness-defaults.ts) or missing entirely (error-name redaction,
 * failure-reason classification) across the fleet API surface.
 * Lives under src/extensions/ so the FORK.md two-touch-point contract
 * is untouched.
 *
 * - withTimeout / ECS_CALL_TIMEOUT_MS — per-call AbortController so a
 *   stuck AWS SDK call can't hang a request indefinitely (#280).
 * - upstreamErrorBody / UPSTREAM_ERROR_CODE — generic client-facing
 *   error code so raw AWS SDK error names never leak in 502 bodies;
 *   handlers still log the real name server-side (#274).
 * - classifyEcsFailures — partition ECS Describe* `failures[]` into
 *   not-found (`MISSING`) vs. permission/other so handlers can return
 *   a 502 for a denial instead of a misleading 404 (#281).
 */

/**
 * Per-call timeout for fleet AWS SDK calls. 5s gives AWS plenty of
 * headroom over the realistic ~50-150ms happy path while preventing
 * indefinite hangs during throttling or transient network issues.
 * Originated in harness-defaults.ts; hoisted here as the shared
 * default for every fleet handler.
 */
export const ECS_CALL_TIMEOUT_MS = 5_000

export interface TimeoutHandle {
  signal: AbortSignal
  /** Clear the underlying timer to avoid orphaned setTimeout callbacks
   *  on the happy path (the timer would otherwise fire seconds later,
   *  abort an already-settled signal, and only then be GC'd). Always
   *  call this in a `finally` after the awaited `.send()`. */
  clear: () => void
}

/**
 * Build an AbortSignal that fires after `timeoutMs`. Pass
 * `{ abortSignal: handle.signal }` as the second arg to a `.send()`
 * call, then `handle.clear()` in a `finally`. A fired signal surfaces
 * as an `AbortError` from the SDK, which the handler maps to a 502.
 */
export function withTimeout(
  timeoutMs: number = ECS_CALL_TIMEOUT_MS,
): TimeoutHandle {
  const ac = new AbortController()
  const id = setTimeout(() => ac.abort(), timeoutMs)
  return { signal: ac.signal, clear: () => clearTimeout(id) }
}

/**
 * Stable, client-facing code returned in 502 bodies in place of the
 * raw AWS SDK error name. Echoing `error.name` (e.g.
 * `AccessDeniedException`, `ThrottlingException`,
 * `UnrecognizedClientException`) leaks internal AWS/IAM topology to
 * any caller. The real name is logged server-side via logger.error.
 */
export const UPSTREAM_ERROR_CODE = 'UpstreamServiceError'

/**
 * Generic 502 response body. Use everywhere a fleet handler's
 * catch-all previously returned `{ error: error.name || 'AWSError' }`.
 * Intentional status-branching that inspects a *known* error.name
 * (e.g. ServiceNotFoundException → 404) stays in place — only the
 * raw-name fallback is redacted.
 */
export function upstreamErrorBody(): { error: typeof UPSTREAM_ERROR_CODE } {
  return { error: UPSTREAM_ERROR_CODE }
}

/** A single entry from an ECS Describe* `failures[]` array. */
export interface EcsFailure {
  arn?: string
  reason?: string
  detail?: string
}

export interface ClassifiedEcsFailures {
  /** reason === 'MISSING' — the service/ARN genuinely does not exist. */
  missing: EcsFailure[]
  /** reason looks authorization-related (access/denied/auth/forbidden). */
  denied: EcsFailure[]
  /** Any other non-MISSING reason (throttling, transient, unknown). */
  other: EcsFailure[]
  /** True when any failure is NOT a plain MISSING — caller should 502
   *  (and log at error) rather than treat the result as not-found. */
  hasNonMissing: boolean
}

/**
 * Partition an ECS Describe* failures array. ECS reports a not-found
 * service ARN as `{ arn, reason: 'MISSING' }`; an IAM denial or other
 * fault on a per-ARN basis surfaces with a different reason. Handlers
 * use this to keep their 404 path for MISSING while returning a 502
 * for anything else, instead of conflating a permission problem with
 * "agent not found."
 */
export function classifyEcsFailures(
  failures: EcsFailure[] | undefined,
): ClassifiedEcsFailures {
  const missing: EcsFailure[] = []
  const denied: EcsFailure[] = []
  const other: EcsFailure[] = []

  for (const f of failures ?? []) {
    const reason = (f.reason ?? '').toUpperCase()
    if (reason === 'MISSING') {
      missing.push(f)
    } else if (/ACCESS|DENIED|AUTH|FORBIDDEN/.test(reason)) {
      denied.push(f)
    } else {
      other.push(f)
    }
  }

  return {
    missing,
    denied,
    other,
    hasNonMissing: denied.length > 0 || other.length > 0,
  }
}
