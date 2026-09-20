import { describe, expect, it, vi } from 'vitest'
import { probeTypeSafeApiKey } from '@/lib/typesafe-probe'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('probeTypeSafeApiKey', () => {
  it('rejects a missing key without making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(probeTypeSafeApiKey('  ', fetchImpl)).resolves.toEqual({
      ok: false,
      detail: 'API key not set',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends only synthetic state and accepts a typed response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, {
      model: 'jev-1.13.0',
      answers: { connectivity: { type: 'noul', noul: 1 } },
      usage: { input_tokens: 10, output_tokens: 2 },
    }))

    await expect(probeTypeSafeApiKey('secret', fetchImpl)).resolves.toEqual({
      ok: true,
      detail: 'API key valid',
    })
    const [, init] = fetchImpl.mock.calls[0] ?? []
    expect(init?.headers).toEqual({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    })
    expect(String(init?.body)).toContain('synthetic connectivity check')
    expect(String(init?.body)).not.toContain('repository')
    expect(String(init?.body)).not.toContain('transaction')
  })

  it('retries one overloaded response and reports safe HTTP detail', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(529, { error: 'overloaded' }))
      .mockResolvedValueOnce(response(401, { error: 'do not expose this' }))

    await expect(probeTypeSafeApiKey('secret', fetchImpl)).resolves.toEqual({
      ok: false,
      detail: 'HTTP 401',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed success bodies', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, {}))
    await expect(probeTypeSafeApiKey('secret', fetchImpl)).resolves.toEqual({
      ok: false,
      detail: 'Unexpected response',
    })
  })
})
