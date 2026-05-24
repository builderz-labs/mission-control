import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

export const MC_SESSION_COOKIE_NAME = '__Host-mc-session'
export const LEGACY_MC_SESSION_COOKIE_NAME = 'mc-session'
const MC_SESSION_COOKIE_NAMES = [MC_SESSION_COOKIE_NAME, LEGACY_MC_SESSION_COOKIE_NAME] as const

export function getMcSessionCookieName(isSecureRequest: boolean): string {
  return isSecureRequest ? MC_SESSION_COOKIE_NAME : LEGACY_MC_SESSION_COOKIE_NAME
}

export function isRequestSecure(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https'
    || new URL(request.url).protocol === 'https:'
}

const MC_SESSION_COOKIE_REGEXPS = MC_SESSION_COOKIE_NAMES.map(
  (name) => ({ name, re: new RegExp(`(?:^|;\\s*)${name}=([^;]*)`) })
)

export function parseMcSessionCookieHeader(cookieHeader: string): string | null {
  if (!cookieHeader) return null
  for (const { re } of MC_SESSION_COOKIE_REGEXPS) {
    const match = cookieHeader.match(re)
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
  const isProduction = process.env.NODE_ENV === 'production'
  const secure = secureEnv ?? input.isSecureRequest ?? isProduction

  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: input.maxAgeSeconds,
    path: '/',
  }
}
