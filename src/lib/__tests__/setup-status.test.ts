import { describe, it, expect, vi } from 'vitest'
import { fetchSetupStatusWithRetry } from '@/lib/setup-status'

describe('fetchSetupStatusWithRetry', () => {
  it('returns setup status on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ needsSetup: true }),
    })

    const result = await fetchSetupStatusWithRetry(fetchMock as any, { attempts: 2, timeoutMs: 2000 })

    expect(result).toEqual({ needsSetup: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and eventually succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ needsSetup: false }),
      })

    const result = await fetchSetupStatusWithRetry(fetchMock as any, { attempts: 3, timeoutMs: 2000 })

    expect(result).toEqual({ needsSetup: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after attempts are exhausted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('still failing'))

    await expect(fetchSetupStatusWithRetry(fetchMock as any, { attempts: 2, timeoutMs: 2000 }))
      .rejects.toThrow('still failing')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on invalid payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ needsSetup: 'yes' }),
    })

    await expect(fetchSetupStatusWithRetry(fetchMock as any, { attempts: 1, timeoutMs: 2000 }))
      .rejects.toThrow('Invalid setup status response')
  })
})
