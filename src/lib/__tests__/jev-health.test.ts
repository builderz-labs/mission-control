import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock('@/lib/typesafe-probe', () => ({ probeTypeSafeApiKey: mocks.probe }))

describe('Jev health cache', () => {
  beforeEach(() => { vi.resetModules(); mocks.probe.mockReset() })

  it('reports missing configuration without a provider request', async () => {
    const { getJevHealth } = await import('@/lib/jev-health')
    await expect(getJevHealth('')).resolves.toMatchObject({ configured: false, healthy: false })
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it('uses a synthetic probe and caches its safe result', async () => {
    mocks.probe.mockResolvedValue({ ok: true, detail: 'API key valid' })
    const { getJevHealth } = await import('@/lib/jev-health')
    await expect(getJevHealth('server-key')).resolves.toMatchObject({ configured: true, healthy: true })
    await getJevHealth('server-key')
    expect(mocks.probe).toHaveBeenCalledOnce()
  })

  it('maps provider failures to a stable health code', async () => {
    mocks.probe.mockRejectedValue(new Error('sensitive upstream detail'))
    const { getJevHealth } = await import('@/lib/jev-health')
    await expect(getJevHealth('server-key')).resolves.toMatchObject({
      configured: true, healthy: false, errorCode: 'JEV_UNAVAILABLE',
    })
  })
})
