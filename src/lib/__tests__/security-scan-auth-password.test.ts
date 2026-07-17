import { afterEach, describe, expect, it } from 'vitest'
import { runSecurityScan } from '@/lib/security-scan'

const originalAuthPass = process.env.AUTH_PASS
const originalAuthPassB64 = process.env.AUTH_PASS_B64

function restore(name: 'AUTH_PASS' | 'AUTH_PASS_B64', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function authPasswordCheck() {
  return runSecurityScan().categories.credentials.checks.find((check) => check.id === 'auth_pass')
}

describe('security scan admin password resolution', () => {
  afterEach(() => {
    restore('AUTH_PASS', originalAuthPass)
    restore('AUTH_PASS_B64', originalAuthPassB64)
  })

  it('accepts a strong base64-only password', () => {
    delete process.env.AUTH_PASS
    process.env.AUTH_PASS_B64 = Buffer.from('strong-password-123').toString('base64')

    expect(authPasswordCheck()).toMatchObject({ status: 'pass' })
  })

  it('uses the plain password when base64 configuration is invalid', () => {
    process.env.AUTH_PASS = 'strong-fallback-123'
    process.env.AUTH_PASS_B64 = '%%%invalid%%%'

    expect(authPasswordCheck()).toMatchObject({ status: 'pass' })
  })

  it('rejects an insecure default supplied through base64 configuration', () => {
    delete process.env.AUTH_PASS
    process.env.AUTH_PASS_B64 = Buffer.from('password').toString('base64')

    expect(authPasswordCheck()).toMatchObject({ status: 'fail' })
  })
})
