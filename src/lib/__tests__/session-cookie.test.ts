import { afterEach, describe, expect, it } from 'vitest'
import { getMcSessionCookieOptions } from '../session-cookie'

describe('getMcSessionCookieOptions', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalCookieSecure = process.env.MC_COOKIE_SECURE

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv

    if (originalCookieSecure === undefined) delete process.env.MC_COOKIE_SECURE
    else process.env.MC_COOKIE_SECURE = originalCookieSecure
  })

  it('does not force secure cookies on plain HTTP in production when MC_COOKIE_SECURE is unset', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(false)
  })

  it('sets secure cookies for HTTPS requests when MC_COOKIE_SECURE is unset', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MC_COOKIE_SECURE

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: true })
    expect(options.secure).toBe(true)
  })

  it('respects MC_COOKIE_SECURE override', () => {
    process.env.NODE_ENV = 'production'
    process.env.MC_COOKIE_SECURE = '1'

    const options = getMcSessionCookieOptions({ maxAgeSeconds: 60, isSecureRequest: false })
    expect(options.secure).toBe(true)
  })
})
