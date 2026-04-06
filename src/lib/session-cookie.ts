import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

export const MC_SESSION_COOKIE_NAME = '__Host-mc-session'

/**
 * @deprecated The plain "mc-session" cookie is no longer accepted by middleware.
 * Kept only so parseMcSessionCookieHeader can still read tokens from
 * clients that have an old cookie before it naturally expires.
 * Remove this constant once the migration window has closed.
 */
export const LEGACY_MC_SESSION_COOKIE_NAME = 'mc-session'

// The __Host- name is checked first so it takes priority when both cookies
// are present — necessary during the migration window.
const MC_SESSION_COOKIE_NAMES = [MC_SESSION_COOKIE_NAME, LEGACY_MC_SESSION_COOKIE_NAME] as const

/**
 * Always returns the __Host-prefixed name regardless of request security.
 * The plain "mc-session" fallback was removed from middleware, so issuing it
 * for HTTP requests would create a cookie the auth gate ignores entirely.
 *
 * @param _isSecureRequest - kept for API compatibility; no longer affects output.
 */
export function getMcSessionCookieName(_isSecureRequest: boolean): string {
  return MC_SESSION_COOKIE_NAME
}

export function isRequestSecure(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https'
    || new URL(request.url).protocol === 'https:'
}

export function parseMcSessionCookieHeader(cookieHeader: string): string | null {
  if (!cookieHeader) return null
  for (const cookieName of MC_SESSION_COOKIE_NAMES) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`))
    if (match) {
      return decodeURIComponent(match[1])
    }
  }
  return null
}

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const v = String(raw).trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return undefined
}

export function getMcSessionCookieOptions(input: { maxAgeSeconds: number; isSecureRequest?: boolean }): Partial<ResponseCookie> {
  const secureEnv = envFlag('MC_COOKIE_SECURE')
  // Default to secure=true in production unless explicitly disabled via MC_COOKIE_SECURE=false
  const productionDefault = process.env.NODE_ENV === 'production'
  const secure = secureEnv ?? input.isSecureRequest ?? productionDefault

  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: input.maxAgeSeconds,
    path: '/',
  }
}
