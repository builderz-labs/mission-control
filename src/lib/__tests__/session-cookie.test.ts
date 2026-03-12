import { afterEach, describe, expect, it } from 'vitest'
import { getMcSessionCookieOptions } from '../session-cookie'

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
