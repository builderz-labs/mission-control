import { afterEach, describe, expect, it } from 'vitest'
import {
  MC_SESSION_COOKIE_NAME,
  LEGACY_MC_SESSION_COOKIE_NAME,
  getMcSessionCookieName,
  isRequestSecure,
  parseMcSessionCookieHeader,
  getMcSessionCookieOptions,
} from '../session-cookie'

describe('getMcSessionCookieName', () => {
  it('returns __Host- prefixed name for secure requests', () => {
    expect(getMcSessionCookieName(true)).toBe(MC_SESSION_COOKIE_NAME)
  })

  it('always returns __Host- prefixed name (legacy fallback removed)', () => {
    // The plain "mc-session" legacy fallback was removed — __Host- is now always issued
    expect(getMcSessionCookieName(false)).toBe(MC_SESSION_COOKIE_NAME)
  })
})

describe('isRequestSecure', () => {
  it('returns true when x-forwarded-proto is https', () => {
    const req = new Request('http://example.com', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(isRequestSecure(req)).toBe(true)
  })

  it('returns false when x-forwarded-proto is http', () => {
    const req = new Request('http://example.com', {
      headers: { 'x-forwarded-proto': 'http' },
    })
    expect(isRequestSecure(req)).toBe(false)
  })

  it('returns true when the request URL is https', () => {
    const req = new Request('https://example.com/path')
    expect(isRequestSecure(req)).toBe(true)
  })

  it('returns false for plain http with no forwarded header', () => {
    const req = new Request('http://example.com/path')
    expect(isRequestSecure(req)).toBe(false)
  })
})

describe('parseMcSessionCookieHeader', () => {
  it('returns null for empty string', () => {
    expect(parseMcSessionCookieHeader('')).toBeNull()
  })

  it('returns null when no session cookie is present', () => {
    expect(parseMcSessionCookieHeader('other=value; another=123')).toBeNull()
  })

  it('parses the __Host- cookie name', () => {
    expect(parseMcSessionCookieHeader(`${MC_SESSION_COOKIE_NAME}=abc123`)).toBe('abc123')
  })

  it('parses the legacy cookie name', () => {
    expect(parseMcSessionCookieHeader(`${LEGACY_MC_SESSION_COOKIE_NAME}=xyz789`)).toBe('xyz789')
  })

  it('parses a cookie mixed with others', () => {
    expect(
      parseMcSessionCookieHeader(`foo=bar; ${MC_SESSION_COOKIE_NAME}=session_value; baz=qux`)
    ).toBe('session_value')
  })

  it('URL-decodes the cookie value', () => {
    const encoded = encodeURIComponent('token with spaces & special=chars')
    expect(
      parseMcSessionCookieHeader(`${MC_SESSION_COOKIE_NAME}=${encoded}`)
    ).toBe('token with spaces & special=chars')
  })

  it('prefers the __Host- name over the legacy name', () => {
    // __Host- name appears first in MC_SESSION_COOKIE_NAMES array
    const header = `${MC_SESSION_COOKIE_NAME}=primary; ${LEGACY_MC_SESSION_COOKIE_NAME}=secondary`
    expect(parseMcSessionCookieHeader(header)).toBe('primary')
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
