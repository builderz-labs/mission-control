import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLogin } from './login-request'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('requestLogin', () => {
  it('sends credentials only in the body and clears its deadline on success', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestLogin('/api/auth/login', { username: 'test', password: 'synthetic' }))
      .toEqual({ ok: true, data: null })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({ username: 'test', password: 'synthetic' }),
    }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains structured authentication errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":"PENDING_APPROVAL"}', { status: 403 })))
    expect(await requestLogin('/api/auth/google', { credential: 'synthetic' }))
      .toEqual({ ok: false, data: { code: 'PENDING_APPROVAL' } })
  })

  it('tolerates a non-JSON server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })))
    expect(await requestLogin('/api/auth/login', { username: 'test', password: 'synthetic' }))
      .toEqual({ ok: false, data: null })
  })

  it.each(['headers', 'body'])('aborts stalled %s without replaying credentials', async (stage) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_path: string, init: RequestInit) => {
      const stalled = new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
      return stage === 'headers' ? stalled : Promise.resolve({ ok: false, json: () => stalled })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = requestLogin('/api/auth/login', { username: 'test', password: 'synthetic' })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer after a network rejection', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    await expect(requestLogin('/api/auth/login', { username: 'test', password: 'synthetic' })).rejects.toThrow('Network error')
    expect(vi.getTimerCount()).toBe(0)
  })
})
