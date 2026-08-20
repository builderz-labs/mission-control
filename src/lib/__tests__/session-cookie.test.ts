import { afterEach, describe, expect, it } from 'vitest'
import { getMcSessionCookieOptions, parseAllMcSessionCookies } from '../session-cookie'

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

describe('parseAllMcSessionCookies', () => {
  it('collects both __Host-mc-session and mc-session tokens from Cookie header', () => {
    const cookieHeader = '__Host-mc-session=secure-token; mc-session=legacy-token; other=value'
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual(['secure-token', 'legacy-token'])
  })

  it('returns empty array when no session cookies are present', () => {
    const cookieHeader = 'other=value; foo=bar'
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual([])
  })

  it('collects only the __Host-mc-session token when mc-session is missing', () => {
    const cookieHeader = '__Host-mc-session=secure-token; other=value'
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual(['secure-token'])
  })

  it('collects only the mc-session token when __Host-mc-session is missing', () => {
    const cookieHeader = 'mc-session=legacy-token; other=value'
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual(['legacy-token'])
  })

  it('handles URL-encoded cookie values', () => {
    const cookieHeader = '__Host-mc-session=secure%20token; mc-session=legacy%20token'
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual(['secure token', 'legacy token'])
  })

  it('does not throw on malformed percent-encoding and returns raw token', () => {
    const cookieHeader = '__Host-mc-session=bad%2; mc-session=also%bad'
    expect(() => parseAllMcSessionCookies(cookieHeader)).not.toThrow()
    const tokens = parseAllMcSessionCookies(cookieHeader)
    expect(tokens).toEqual(['bad%2', 'also%bad'])
  })
})
