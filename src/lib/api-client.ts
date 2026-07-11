/**
 * API client with global 401 / 403 / network handling.
 *
 * Why this exists
 * ---------------
 * Mission Control had no global auth-failure handler. When a session expired,
 * `fetch('/api/...')` returned 401 silently and panels (cost-tracker, dashboard,
 * activities) stuck on loading skeletons forever — users perceived "the service
 * died" but the backend was healthy. Root cause logged in:
 *   src/lib/auth.ts:629  requireRole()
 *
 * Contract
 * --------
 *   apiFetch<T>(path, init?) -> Promise<T>
 *
 *   - Always sends cookies (credentials: 'include')
 *   - On 401: emits an `mc:auth-expired` CustomEvent, redirects to /login?from=…
 *   - On 403: throws ApiError with code='FORBIDDEN'
 *   - On 5xx: throws ApiError with code='SERVER_ERROR' and the upstream message
 *   - On network failure: throws ApiError with code='NETWORK_ERROR'
 *
 * Listen once at app root:
 *   window.addEventListener('mc:auth-expired', () => showToast('Session expired'))
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'REQUEST_FAILED'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly payload: unknown

  constructor(code: ApiErrorCode, status: number, message: string, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.payload = payload
  }
}

// Browser-only redirect to /login. SSR / unit tests skip it.
function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  const from = window.location.pathname + window.location.search
  // Avoid redirect loops if user is already on /login
  if (window.location.pathname === '/login') return
  window.location.href = `/login?from=${encodeURIComponent(from)}`
}

function emitAuthExpired(detail: { path: string; status: number }): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('mc:auth-expired', { detail }))
}
export interface ApiFetchOptions extends RequestInit {
  /** When true (default) and the response is 401, redirect to /login. */
  redirectOnUnauthenticated?: boolean
  /** When true, return raw Response instead of parsed JSON. */
  raw?: boolean
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const {
    redirectOnUnauthenticated = true,
    raw = false,
    headers,
    ...rest
  } = options

  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(rest.body && !(rest.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...headers,
      },
      ...rest,
    })
  } catch (err) {
    throw new ApiError(
      'NETWORK_ERROR',
      0,
      err instanceof Error ? err.message : 'Network request failed'
    )
  }

  // 401 — emit event, optionally redirect, always throw
  if (response.status === 401) {
    emitAuthExpired({ path, status: 401 })
    if (redirectOnUnauthenticated) redirectToLogin()
    throw new ApiError('UNAUTHENTICATED', 401, 'Authentication required')
  }

  // 403 — throw, do NOT redirect (user is logged in but lacks role)
  if (response.status === 403) {
    const payload = await safeParseJson(response)
    throw new ApiError('FORBIDDEN', 403, 'Insufficient permissions', payload)
  }

  if (response.status === 404) {
    throw new ApiError('NOT_FOUND', 404, `Not found: ${path}`)
  }

  if (response.status >= 500) {
    const payload = await safeParseJson(response)
    const msg =
      (typeof payload === 'object' && payload !== null && 'error' in payload &&
        typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : null) || `Server error ${response.status}`
    throw new ApiError('SERVER_ERROR', response.status, msg, payload)
  }

  // Any other non-2xx (400, 409, 422, 429, ...) — throw with the server payload
  // so callers don't proceed on validation/conflict/rate-limit errors as if the
  // response body were success data. Callers that need the raw error body opt in
  // with `raw: true`.
  if (!response.ok) {
    const payload = await safeParseJson(response)
    const msg =
      (typeof payload === 'object' && payload !== null && 'error' in payload &&
        typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : null) || `Request failed (${response.status})`
    throw new ApiError('REQUEST_FAILED', response.status, msg, payload)
  }

  if (raw) return response as unknown as T

  if (response.status === 204) return undefined as T

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('PARSE_ERROR', response.status, 'Response was not valid JSON')
  }
}

async function safeParseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

