'use client'

import { useEffect } from 'react'

/**
 * Listens for `mc:auth-expired` CustomEvent dispatched by `apiFetch()` when the
 * server returns 401. The redirect to `/login?from=...` is already handled inside
 * `apiFetch`; this listener exists so we have a single observability hook the
 * team can extend (toast, telemetry, Sentry).
 *
 * Mounted once at the root layout. SSR-safe (effect runs only on the client).
 *
 * Why a separate component?
 *   - layout.tsx is a server component (uses `await headers()`); we cannot
 *     attach window listeners there directly.
 *   - Co-locating the listener with the api-client keeps the auth-failure
 *     contract in one place.
 */
export function AuthExpiredListener(): null {
  useEffect(() => {
    const onExpired = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; status: number }>).detail
      // No toast lib installed yet — log for now. Replace with sonner in next PR.
      console.warn(
        `[mc] session expired on ${detail?.path ?? 'unknown'} (status=${detail?.status ?? 401}), redirecting to /login`
      )
    }
    window.addEventListener('mc:auth-expired', onExpired)
    return () => window.removeEventListener('mc:auth-expired', onExpired)
  }, [])

  return null
}
