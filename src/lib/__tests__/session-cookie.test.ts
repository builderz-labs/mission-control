import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_MC_SESSION_COOKIE_NAME,
  MC_SESSION_COOKIE_NAME,
  expireAllMcSessionCookies,
  getMcSessionCookieOptions,
  parseAllMcSessionCookieTokens,
  parseMcSessionCookieHeader,
} from '../session-cookie'

describe('session cookie parsing and expiry', () => {
  it('collects both secure and legacy session tokens', () => {
    const header = `${MC_SESSION_COOKIE_NAME}=secure-token; ${LEGACY_MC_SESSION_COOKIE_NAME}=legacy-token`
    expect(parseAllMcSessionCookieTokens(header)).toEqual(['secure-token', 'legacy-token'])
    // First match remains the preferred token for request auth.
    expect(parseMcSessionCookieHeader(header)).toBe('secure-token')
  })

  it('expires both session cookie names on logout', () => {
    const setCalls: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []
    const response = {
      cookies: {
        set: (name: string, value: string, options?: Record<string, unknown>) => {
          setCalls.push({ name, value, options })
        },
      },
    }

    expireAllMcSessionCookies(response, true)

    expect(setCalls.map((c) => c.name)).toEqual([
      MC_SESSION_COOKIE_NAME,
      LEGACY_MC_SESSION_COOKIE_NAME,
    ])
    expect(setCalls.every((c) => c.value === '' && c.options?.maxAge === 0)).toBe(true)
    expect(setCalls[0].options?.secure).toBe(true)
  })
})

describe('getMcSessionCookieOptions', () => {
  const env = process.env as Record<string, string | undefined>
  const originalNodeEnv = env.NODE_ENV
  const originalCookieSecure = env.MC_COOKIE_SECURE

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = originalNodeEnv

    if (originalCookieSecure === undefined) delete env.MC_COOKIE_SECURE
    else env.MC_COOKIE_SECURE = originalCookieSecure
  })

  it('does not force secure cookies on plain HTTP in production when MC_COOKIE_SECURE is unset', () => {
    env.NODE_ENV = 'production'
    delete env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(false)
  })

  it('sets secure cookies for HTTPS requests when MC_COOKIE_SECURE is unset', () => {
    env.NODE_ENV = 'production'
    delete env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: true })
    expect(options.secure).toBe(true)
  })

  it('respects MC_COOKIE_SECURE override', () => {
    env.NODE_ENV = 'production'
    env.MC_COOKIE_SECURE = '1'

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(true)
  })
})
