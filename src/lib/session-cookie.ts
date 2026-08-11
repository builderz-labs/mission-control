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

export function parseMcSessionCookieHeader(cookieHeader: string): string | null {
  const tokens = parseAllMcSessionCookieTokens(cookieHeader)
  return tokens[0] ?? null
}

/** Return every presented Mission Control session token (secure + legacy names). */
export function parseAllMcSessionCookieTokens(cookieHeader: string): string[] {
  if (!cookieHeader) return []
  const tokens: string[] = []
  for (const cookieName of MC_SESSION_COOKIE_NAMES) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`))
    if (!match) continue
    try {
      tokens.push(decodeURIComponent(match[1]))
    } catch {
      tokens.push(match[1])
    }
  }
  return tokens
}

/**
 * Expire both the __Host- and legacy session cookies so HTTP→HTTPS transitions
 * cannot leave a valid session behind after logout.
 */
export function expireAllMcSessionCookies(
  response: { cookies: { set: (name: string, value: string, options?: Partial<ResponseCookie>) => void } },
  isSecureRequest: boolean,
): void {
  // __Host- cookies require Secure; always clear with that attribute.
  response.cookies.set(MC_SESSION_COOKIE_NAME, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest: true }),
    secure: true,
  })
  response.cookies.set(LEGACY_MC_SESSION_COOKIE_NAME, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest }),
  })
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
