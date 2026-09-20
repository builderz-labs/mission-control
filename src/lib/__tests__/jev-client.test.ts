// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateWithJev, JevClientError } from '@/lib/jev-client'

const request = {
  state: 'A pull request summary',
  model: 'jev-latest',
  questions: { safe: { type: 'noul' as const, instructions: 'Is it safe?' } },
}

function response(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Jev SDK boundary', () => {
  it('returns typed results and request provenance without exposing the key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, {
      model: 'jev-1.13.0', answers: { safe: { type: 'noul', noul: 0.9 } },
      usage: { input_tokens: 12, output_tokens: 3 },
    }, { 'x-typesafe-request-id': 'req_123' }))
    const result = await evaluateWithJev(request, { apiKey: 'private-key', fetch: fetchMock })
    expect(result).toMatchObject({ model: 'jev-1.13.0', requestId: 'req_123' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.typesafe.ai/v1/systemone')
  })

  it('retries an overloaded response exactly once', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(529, { error: 'overloaded' }))
      .mockResolvedValueOnce(response(200, {
        model: 'jev-1.13.0', answers: { safe: { type: 'noul', noul: 1 } },
        usage: { input_tokens: 1, output_tokens: 1 },
    }))
    const pending = evaluateWithJev(request, { apiKey: 'key', fetch: fetchMock })
    const assertion = expect(pending).resolves.toMatchObject({ model: 'jev-1.13.0' })
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps provider authentication bodies to a safe error code', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(401, { error: 'sensitive provider detail' }))
    await expect(evaluateWithJev(request, { apiKey: 'bad', fetch: fetchMock })).rejects.toEqual(
      expect.objectContaining({ code: 'JEV_CREDENTIAL_REJECTED', status: 502 }),
    )
    await evaluateWithJev(request, { apiKey: 'bad', fetch: fetchMock }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(JevClientError)
      expect(String(error)).not.toContain('sensitive provider detail')
    })
  })

  it('fails closed when no server key exists', async () => {
    const original = process.env.TYPESAFE_API_KEY
    delete process.env.TYPESAFE_API_KEY
    await expect(evaluateWithJev(request)).rejects.toMatchObject({ code: 'JEV_NOT_CONFIGURED', status: 503 })
    if (original) process.env.TYPESAFE_API_KEY = original
  })
})
