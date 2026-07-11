import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { apiFetch, ApiError } from '../api-client'

const realFetch = global.fetch
const realLocation = window.location

function mockResponse(status: number, body: unknown = {}, opts: { json?: boolean } = { json: true }) {
  return new Response(opts.json ? JSON.stringify(body) : String(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch — global 401 / 403 / 5xx / network handling', () => {
  let dispatched: CustomEvent[] = []
  let originalHref = ''
  let authExpiredListener: ((e: Event) => void) | null = null

  beforeEach(() => {
    dispatched = []
    authExpiredListener = (e) => dispatched.push(e as CustomEvent)
    window.addEventListener('mc:auth-expired', authExpiredListener)

    // Stub location so redirect-to-login is observable
    originalHref = window.location.href
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...realLocation,
        pathname: '/cost-tracker',
        search: '',
        href: 'http://127.0.0.1:3000/cost-tracker',
      },
    })
  })

  afterEach(() => {
    if (authExpiredListener) {
      window.removeEventListener('mc:auth-expired', authExpiredListener)
      authExpiredListener = null
    }
    global.fetch = realFetch
    Object.defineProperty(window, 'location', { writable: true, value: realLocation })
    window.location.href = originalHref
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on 200', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(200, { ok: true, count: 42 }))
    const data = await apiFetch<{ ok: boolean; count: number }>('/api/tokens')
    expect(data).toEqual({ ok: true, count: 42 })
  })

  it('emits mc:auth-expired and redirects to /login on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(401, { error: 'Authentication required' }))
    await expect(apiFetch('/api/tokens')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail).toMatchObject({ path: '/api/tokens', status: 401 })
    expect(window.location.href).toContain('/login?from=%2Fcost-tracker')
  })

  it('does NOT redirect when redirectOnUnauthenticated=false', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(401, { error: 'Authentication required' }))
    await expect(
      apiFetch('/api/tokens', { redirectOnUnauthenticated: false })
    ).rejects.toThrow(ApiError)
    expect(window.location.href).toBe('http://127.0.0.1:3000/cost-tracker')
  })

  it('throws FORBIDDEN on 403 without redirecting', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(403, { error: 'Requires admin role' }))
    await expect(apiFetch('/api/tokens')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(window.location.href).toBe('http://127.0.0.1:3000/cost-tracker')
  })

  it('throws SERVER_ERROR on 500 with upstream message', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(500, { error: 'database is locked' }))
    await expect(apiFetch('/api/tokens')).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      status: 500,
      message: 'database is locked',
    })
  })

  it('throws NETWORK_ERROR when fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiFetch('/api/tokens')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    })
  })

  it('does not redirect when already on /login (avoid infinite loop)', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...realLocation, pathname: '/login', search: '', href: 'http://127.0.0.1:3000/login' },
    })
    global.fetch = vi.fn().mockResolvedValue(mockResponse(401))
    await expect(apiFetch('/api/auth/login', { method: 'POST' })).rejects.toThrow(ApiError)
    expect(window.location.href).toBe('http://127.0.0.1:3000/login')
  })

  it('returns undefined for 204 No Content', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const data = await apiFetch('/api/sessions/123', { method: 'DELETE' })
    expect(data).toBeUndefined()
  })

  it.each([400, 409, 422, 429])(
    'throws ApiError on %i instead of returning the error body as success',
    async (status) => {
      global.fetch = vi.fn().mockResolvedValue(mockResponse(status, { error: 'nope' }))
      await expect(apiFetch('/api/tasks', { method: 'POST' })).rejects.toMatchObject({
        status,
        payload: { error: 'nope' },
      })
    },
  )

  it('carries the server payload on a thrown 4xx so callers can read .error', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(422, { error: 'label blocked' }))
    await expect(apiFetch('/api/spawn', { method: 'POST' })).rejects.toThrow(ApiError)
  })
})
