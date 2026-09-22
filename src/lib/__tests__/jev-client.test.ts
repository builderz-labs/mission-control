// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateWithJev, JevClientError } from '@/lib/jev-client'

const request = {
  state: 'A pull request summary',
  model: 'jev-latest',
  questions: { safe: { type: 'noul' as const, instructions: 'Is it safe?' } },
}

const mixedRequest = {
  state: 'Release evidence', model: 'jev-latest',
  questions: {
    risk: {
      type: 'choice' as const, instructions: 'Dominant risk?',
      criteria: { security: 'Security', reliability: 'Reliability' },
    },
    evidence: {
      type: 'score' as const, instructions: 'Evidence quality?',
      criteria: ['Weak', 'Adequate', 'Strong'],
    },
  },
}

const validMixedAnswers = {
  risk: {
    type: 'choice', choice: 'security', confidence: 0.8,
    probabilities: { security: 0.8, reliability: 0.2 },
  },
  evidence: {
    type: 'score', score: 1.5, confidence: 0.7,
    probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
    legend: { 0: 'Weak', 1: 'Adequate', 2: 'Strong' },
  },
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

  it.each([
    { model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
    { model: 'jev-1.13.0', answers: { safe: { type: 'noul', noul: 1.2 } }, usage: { input_tokens: 1, output_tokens: 1 } },
    { model: 'jev-1.13.0', answers: { safe: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } },
    { model: 'jev-1.13.0', answers: { safe: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: -1, output_tokens: 1 } },
  ])('rejects malformed successful provider data without persisting it', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, body))
    await expect(evaluateWithJev(request, { apiKey: 'key', fetch: fetchMock })).rejects.toMatchObject({
      code: 'JEV_INVALID_RESPONSE', status: 502,
    })
  })

  it('accepts complete Choice and Score contracts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, {
      model: 'jev-1.13.0', answers: validMixedAnswers,
      usage: { input_tokens: 12, output_tokens: 8 },
    }))
    await expect(evaluateWithJev(mixedRequest, { apiKey: 'key', fetch: fetchMock }))
      .resolves.toMatchObject({ answers: validMixedAnswers })
  })

  it.each([
    {
      ...validMixedAnswers,
      risk: { ...validMixedAnswers.risk, probabilities: { security: 1 } },
    },
    {
      ...validMixedAnswers,
      evidence: { ...validMixedAnswers.evidence, score: 3 },
    },
    {
      ...validMixedAnswers,
      evidence: { ...validMixedAnswers.evidence, probabilities: { 0: 0.2, 1: 0.8 } },
    },
    {
      ...validMixedAnswers,
      evidence: { ...validMixedAnswers.evidence, legend: { 0: 'Weak', 1: 'Wrong', 2: 'Strong' } },
    },
    {
      ...validMixedAnswers,
      evidence: { ...validMixedAnswers.evidence, score: 0.4 },
    },
  ])('rejects incomplete or inconsistent Choice and Score contracts', async (answers) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(200, {
      model: 'jev-1.13.0', answers, usage: { input_tokens: 1, output_tokens: 1 },
    }))
    await expect(evaluateWithJev(mixedRequest, { apiKey: 'key', fetch: fetchMock }))
      .rejects.toMatchObject({ code: 'JEV_INVALID_RESPONSE', status: 502 })
  })
})
