import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchWithClerkRetry,
  resolveClerkSignInUrl,
  decodePublishableKeyDomain,
} from '../fetch-with-clerk-retry'

describe('fetchWithClerkRetry', () => {
  const originalFetch = global.fetch
  const originalAssign = window.location.assign

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        href: 'https://mc-ceremonia.holalumina.com/agents',
        assign: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: originalAssign },
    })
    delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  })

  it('returns response immediately on 200 without retry', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 }))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await fetchWithClerkRetry('/api/agents', { loginFallbackPath: '/login' })
    expect(res?.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries 401 with backoff and returns 200 on recovery', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const promise = fetchWithClerkRetry('/api/agents', {
      loginFallbackPath: '/login',
      retryDelaysMs: [10],
    })
    await vi.advanceTimersByTimeAsync(10)
    const res = await promise

    expect(res?.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries with second backoff if first retry still 401', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const promise = fetchWithClerkRetry('/api/agents', {
      loginFallbackPath: '/login',
      retryDelaysMs: [10, 30],
    })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(30)
    const res = await promise

    expect(res?.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('escalates to redirect when all retries exhausted', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    global.fetch = fetchSpy as unknown as typeof fetch
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = 'https://app.holalumina.com/admin/login'

    const promise = fetchWithClerkRetry('/api/agents', {
      loginFallbackPath: '/login',
      retryDelaysMs: [10, 30],
    })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(30)
    const res = await promise

    expect(res).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining('https://app.holalumina.com/admin/login?redirect_url='),
    )
  })

  it('does not retry non-401 status', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 }))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await fetchWithClerkRetry('/api/agents', { loginFallbackPath: '/login' })
    expect(res?.status).toBe(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to inner /login path when no Clerk env configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const promise = fetchWithClerkRetry('/api/agents', {
      loginFallbackPath: '/login?next=%2Fagents',
      retryDelaysMs: [10, 30],
    })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(30)
    await promise

    expect(window.location.assign).toHaveBeenCalledWith('/login?next=%2Fagents')
  })
})

describe('resolveClerkSignInUrl', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  })

  it('uses NEXT_PUBLIC_CLERK_SIGN_IN_URL when set and appends redirect_url', () => {
    process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = 'https://app.holalumina.com/admin/login'
    const url = resolveClerkSignInUrl('/login')
    expect(url).toContain('https://app.holalumina.com/admin/login')
    expect(url).toContain('redirect_url=')
  })

  it('derives from publishable key domain when explicit env unset', () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = `pk_live_${Buffer.from('clerk.holalumina.com$').toString('base64')}`
    const url = resolveClerkSignInUrl('/login')
    expect(url).toContain('https://clerk.holalumina.com/sign-in')
  })

  it('returns loginFallbackPath when neither env configured', () => {
    const url = resolveClerkSignInUrl('/login?next=%2Fsettings')
    expect(url).toBe('/login?next=%2Fsettings')
  })
})

describe('decodePublishableKeyDomain', () => {
  it('decodes valid live key', () => {
    const pk = `pk_live_${Buffer.from('clerk.holalumina.com$').toString('base64')}`
    expect(decodePublishableKeyDomain(pk)).toBe('clerk.holalumina.com')
  })

  it('decodes valid test key', () => {
    const pk = `pk_test_${Buffer.from('flexible-python-22.clerk.accounts.dev$').toString('base64')}`
    expect(decodePublishableKeyDomain(pk)).toBe('flexible-python-22.clerk.accounts.dev')
  })

  it('returns null for malformed key', () => {
    expect(decodePublishableKeyDomain('not_a_pk_key')).toBeNull()
    expect(decodePublishableKeyDomain('')).toBeNull()
  })
})
