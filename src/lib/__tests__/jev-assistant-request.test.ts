// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateJevAssistantRequest } from '@/lib/jev-assistant-request'

function request(body: string, contentLength?: number): Request {
  return new Request('http://localhost/api/jev/assistant', {
    method: 'POST',
    headers: contentLength === undefined ? undefined : { 'content-length': String(contentLength) },
    body,
  })
}

describe('Jev assistant request boundary', () => {
  it('rejects declared oversized bodies before reading JSON', async () => {
    const result = await validateJevAssistantRequest(request('{}', 80_001))
    expect('error' in result && result.error.status).toBe(400)
  })

  it('rejects deeply nested JSON before Zod recursion', async () => {
    const nested = `${'{"value":'.repeat(41)}null${'}'.repeat(41)}`
    const result = await validateJevAssistantRequest(request(nested))
    expect('error' in result && await result.error.json()).toMatchObject({
      error: 'Assistant request exceeds the nesting limit',
    })
  })

  it('accepts a bounded valid assistant request', async () => {
    const result = await validateJevAssistantRequest(request(JSON.stringify({
      action: 'draft', goal: 'Assess release readiness', answers: {}, projectIds: [1],
    })))
    expect(result).toMatchObject({ data: { goal: 'Assess release readiness' } })
  })
})
