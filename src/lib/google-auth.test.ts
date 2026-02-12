import { describe, expect, it, vi } from 'vitest'

import { verifyGoogleIdToken } from './google-auth'

describe('verifyGoogleIdToken', () => {
  it('rejects missing credentials', async () => {
    await expect(verifyGoogleIdToken('')).rejects.toThrow(/Missing Google credential/i)
  })

  it('rejects when Google tokeninfo returns non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false } as any)))
    await expect(verifyGoogleIdToken('bad')).rejects.toThrow(/Invalid Google token/i)
    vi.unstubAllGlobals()
  })

  it('rejects unverified emails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ aud: 'x', email: 'user@example.com', sub: 'sub', email_verified: false }),
    } as any)))

    await expect(verifyGoogleIdToken('t')).rejects.toThrow(/not verified/i)
    vi.unstubAllGlobals()
  })

  it('rejects audience mismatch when GOOGLE_CLIENT_ID is set', async () => {
    const prev = process.env.GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_ID = 'expected'

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ aud: 'wrong', email: 'user@example.com', sub: 'sub', email_verified: true }),
    } as any)))

    await expect(verifyGoogleIdToken('t')).rejects.toThrow(/audience mismatch/i)

    vi.unstubAllGlobals()
    process.env.GOOGLE_CLIENT_ID = prev
  })

  it('returns payload for valid tokens', async () => {
    const prevGoogle = process.env.GOOGLE_CLIENT_ID
    const prevPublic = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    // This repo may have these set via local `.env`; clear them for a deterministic test.
    process.env.GOOGLE_CLIENT_ID = ''
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = ''

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ aud: 'x', email: 'user@example.com', sub: 'sub', email_verified: 'true', name: 'User' }),
    } as any)))

    await expect(verifyGoogleIdToken('t')).resolves.toMatchObject({
      email: 'user@example.com',
      sub: 'sub',
    })

    vi.unstubAllGlobals()
    process.env.GOOGLE_CLIENT_ID = prevGoogle
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = prevPublic
  })
})
