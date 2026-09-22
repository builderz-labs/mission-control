import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api-client'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('API request deadlines', () => {
  it('keeps the default deadline for ordinary requests', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await apiFetch('/api/example')
    expect(timeout).toHaveBeenCalledWith(20_000)
  })

  it('allows Jev drafting to finish both bounded provider attempts', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"draft":{}}'))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/jev/assistant', { method: 'POST', timeoutMs: 140_000 })
    expect(timeout).toHaveBeenCalledWith(140_000)
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('timeoutMs')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('retains cancellation for long-running drafts without replaying them', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = apiFetch('/api/jev/assistant', { method: 'POST', timeoutMs: 140_000, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([0, -1, 180_001, NaN, Infinity, 1.5])('rejects an invalid deadline %s before sending', async (timeoutMs) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/example', { timeoutMs })).rejects.toMatchObject({ code: 'CLIENT_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
