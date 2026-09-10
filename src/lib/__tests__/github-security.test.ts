import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime-env', () => ({
  getEffectiveEnvValue: vi.fn(async () => 'test-token'),
}))

import { githubFetch } from '@/lib/github'

describe('githubFetch security boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    'https://example.com/repos/owner/repo',
    '//example.com/repos/owner/repo',
    'http://api.github.com/repos/owner/repo',
    'https://user:pass@api.github.com/repos/owner/repo',
    '/\\example.com/repos/owner/repo',
    '/repos/owner/repo\nHost: example.com',
  ])('rejects authenticated requests outside the GitHub API origin: %s', async (target) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(githubFetch(target)).rejects.toThrow(
      'GitHub API requests must use a safe relative path'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a relative GitHub API path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    await expect(githubFetch('/repos/owner/repo?state=open')).resolves.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo?state=open',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    )
  })

  it('retries once on a 5xx GET response after cancelling the first body', async () => {
    const cancel = vi.fn(async () => undefined)
    const failed = new Response('fail', { status: 502 })
    if (failed.body) vi.spyOn(failed.body, 'cancel').mockImplementation(cancel)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    await expect(githubFetch('/repos/owner/repo')).resolves.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalled()
  })

  it('does not retry a 5xx POST that may have created a resource', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 502 }))

    const response = await githubFetch('/repos/owner/repo/issues', {
      method: 'POST',
      body: JSON.stringify({ title: 'dup' }),
    })
    expect(response.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
