'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Listens for `mc:auth-expired` CustomEvent dispatched by `apiFetch()` when the
 * server returns 401. The redirect to `/login?from=...` is already handled inside
 * `apiFetch`; this listener adds a single toast + console hook for observability.
 *
 * Mounted once at the root layout. SSR-safe (effect runs only on the client).
 */
export function AuthExpiredListener(): null {
  useEffect(() => {
    const onExpired = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; status: number }>).detail
      const path = detail?.path ?? 'unknown'
      const status = detail?.status ?? 401
      console.warn(`[mc] session expired on ${path} (status=${status}), redirecting to /login`)
      toast.warning('Session expired', {
        description: 'Sign in again to continue.',
        id: 'mc-auth-expired',
      })
    }
    window.addEventListener('mc:auth-expired', onExpired)
    return () => window.removeEventListener('mc:auth-expired', onExpired)
  }, [])

  return null
}
