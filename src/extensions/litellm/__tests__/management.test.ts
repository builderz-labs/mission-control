import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LiteLLMManagementClient,
  LiteLLMManagementError,
} from '@/extensions/litellm/management'

const BASE = 'http://internal-litellm.example.com'
const MASTER = 'sk-master-NEVER-LOG'

const mkResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    json: async () => body,
  }) as unknown as Response

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('LiteLLMManagementClient.generateKeyWithRotation', () => {
  it('POSTs key_alias + models + max_budget with Bearer auth, returns the new key', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(200, { key: 'sk-virtual-abc' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const out = await client.generateKeyWithRotation({
      alias: 'ender-stack-dev-hello-bot',
      models: ['openai/smart-router', 'anthropic/claude-haiku-4-5'],
      maxBudget: 50,
    })
    expect(out.key).toBe('sk-virtual-abc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/key/generate`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${MASTER}`)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      key_alias: 'ender-stack-dev-hello-bot',
      models: ['openai/smart-router', 'anthropic/claude-haiku-4-5'],
      max_budget: 50,
    })
  })

  it('trims a trailing slash on baseUrl so the path joins cleanly', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(200, { key: 'sk-x' }))
    const client = new LiteLLMManagementClient(`${BASE}/`, MASTER)
    await client.generateKeyWithRotation({
      alias: 'a',
      models: ['m'],
      maxBudget: 1,
    })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE}/key/generate`)
  })

  it('throws LiteLLMManagementError(retriable=false) on a non-duplicate 4xx', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(400, { detail: 'bad models' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    await expect(
      client.generateKeyWithRotation({ alias: 'a', models: ['x'], maxBudget: 1 }),
    ).rejects.toMatchObject({
      name: 'LiteLLMManagementError',
      status: 400,
      retriable: false,
    })
  })

  it('throws LiteLLMManagementError(retriable=true) on a 5xx after MAX_POST_ATTEMPTS', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 503,
      retriable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws LiteLLMManagementError(retriable=true) on a 429 after MAX_POST_ATTEMPTS', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse(429, 'rate limited'))
      .mockResolvedValueOnce(mkResponse(429, 'rate limited'))
      .mockResolvedValueOnce(mkResponse(429, 'rate limited'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 429,
      retriable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a 429 and succeeds when the proxy clears the rate-limit window', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse(429, 'rate limited'))
      .mockResolvedValueOnce(mkResponse(200, { key: 'sk-after-retry' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    })
    await vi.runAllTimersAsync()
    const out = await p
    expect(out.key).toBe('sk-after-retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a 5xx and succeeds on the next attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
      .mockResolvedValueOnce(mkResponse(200, { key: 'sk-after-5xx' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    })
    await vi.runAllTimersAsync()
    const out = await p
    expect(out.key).toBe('sk-after-5xx')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws LiteLLMManagementError when the proxy returns 200 but no key', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(200, { not_a_key: true }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    await expect(
      client.generateKeyWithRotation({ alias: 'a', models: ['x'], maxBudget: 1 }),
    ).rejects.toMatchObject({
      name: 'LiteLLMManagementError',
      status: 200,
      retriable: false,
    })
  })

  it('throws LiteLLMManagementError(retriable=true) on fetch network failure after MAX_POST_ATTEMPTS', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 0,
      retriable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('maps AbortError (5s timeout firing) → LiteLLMManagementError(retriable=true)', async () => {
    // The behavior under test is the error-mapping branch in
    // postOnce()'s catch: an AbortError-shaped rejection must
    // produce LiteLLMManagementError(status=0, retriable=true),
    // same as a network-failure rejection. Simulate the AbortError
    // directly rather than driving the abort timer — keeps the
    // test scoped to the mapping logic.
    const abortErr = new Error('The operation was aborted.')
    abortErr.name = 'AbortError'
    fetchMock
      .mockRejectedValueOnce(abortErr)
      .mockRejectedValueOnce(abortErr)
      .mockRejectedValueOnce(abortErr)
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['x'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 0,
      retriable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('LiteLLMManagementClient.deleteKey', () => {
  it('POSTs key_aliases array', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(200, { deleted: 1 }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const out = await client.deleteKey({ alias: 'ender-stack-dev-hello-bot' })
    expect(out.alreadyDeleted).toBe(false)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/key/delete`)
    expect(JSON.parse(init.body as string)).toEqual({
      key_aliases: ['ender-stack-dev-hello-bot'],
    })
  })

  it('treats 404 as already-deleted (idempotent)', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(404, { detail: 'not found' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const out = await client.deleteKey({ alias: 'gone-already' })
    expect(out.alreadyDeleted).toBe(true)
  })

  it('propagates non-404 errors', async () => {
    // 500 is retriable — exhausts MAX_POST_ATTEMPTS before propagating.
    fetchMock
      .mockResolvedValueOnce(mkResponse(500, 'kaboom'))
      .mockResolvedValueOnce(mkResponse(500, 'kaboom'))
      .mockResolvedValueOnce(mkResponse(500, 'kaboom'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.deleteKey({ alias: 'x' }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toBeInstanceOf(LiteLLMManagementError)
  })
})

describe('LiteLLMManagementClient.generateKeyWithRotation (#354 round-2)', () => {
  it('returns the new key directly when no alias conflict', async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(200, { key: 'sk-fresh' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const out = await client.generateKeyWithRotation({
      alias: 'a',
      models: ['m'],
      maxBudget: 1,
    })
    expect(out.key).toBe('sk-fresh')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on duplicate-alias 400, calls /key/delete then retries /key/generate', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkResponse(400, { detail: 'key_alias already exists for this user' }),
      )
      .mockResolvedValueOnce(mkResponse(200, { deleted: 1 })) // /key/delete
      .mockResolvedValueOnce(mkResponse(200, { key: 'sk-rotated' }))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const out = await client.generateKeyWithRotation({
      alias: 'ender-stack-dev-hello-bot',
      models: ['m'],
      maxBudget: 1,
    })
    expect(out.key).toBe('sk-rotated')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const paths = fetchMock.mock.calls.map(
      (c) => (c[0] as string).replace(BASE, ''),
    )
    expect(paths).toEqual(['/key/generate', '/key/delete', '/key/generate'])
  })

  it('propagates rotation deleteKey 5xx without swallowing', async () => {
    // Duplicate-alias on initial /key/generate → triggers rotation;
    // /key/delete returns 5xx and exhausts MAX_POST_ATTEMPTS → expect
    // LiteLLMManagementError(503) to propagate (caller in agents.ts
    // maps to 502). Critically: the rotation's /key/generate retry is
    // never reached because /key/delete failed first.
    fetchMock
      .mockResolvedValueOnce(
        mkResponse(400, { detail: 'key_alias already exists' }),
      )
      .mockResolvedValueOnce(mkResponse(503, 'litellm proxy busy'))
      .mockResolvedValueOnce(mkResponse(503, 'litellm proxy busy'))
      .mockResolvedValueOnce(mkResponse(503, 'litellm proxy busy'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['m'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 503,
      retriable: true,
    })
    // 1 /key/generate (400, not retriable) + 3 /key/delete (503, retried).
    // No /key/generate rotation attempt was made.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const paths = fetchMock.mock.calls.map(
      (c) => (c[0] as string).replace(BASE, ''),
    )
    expect(paths).toEqual([
      '/key/generate',
      '/key/delete',
      '/key/delete',
      '/key/delete',
    ])
  })

  it('only retries ONCE — second consecutive duplicate-alias error propagates', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkResponse(400, { detail: 'duplicate key_alias detected' }),
      )
      .mockResolvedValueOnce(mkResponse(200, { deleted: 1 }))
      .mockResolvedValueOnce(
        mkResponse(400, { detail: 'key_alias already exists' }),
      )
    const client = new LiteLLMManagementClient(BASE, MASTER)
    await expect(
      client.generateKeyWithRotation({
        alias: 'a',
        models: ['m'],
        maxBudget: 1,
      }),
    ).rejects.toMatchObject({ name: 'LiteLLMManagementError', status: 400 })
  })

  it('propagates non-duplicate-alias 400s without rotating', async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse(400, { detail: 'models field is required' }),
    )
    const client = new LiteLLMManagementClient(BASE, MASTER)
    await expect(
      client.generateKeyWithRotation({
        alias: 'a',
        models: [],
        maxBudget: 1,
      }),
    ).rejects.toMatchObject({ name: 'LiteLLMManagementError', status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no rotate
  })

  it('does NOT rotate on unrelated "already exists" 400s (round-3 audit, regex tightened)', async () => {
    // Regression guard: prior regex `already exists` arm would have
    // matched this and silently rotated a valid key.
    fetchMock.mockResolvedValueOnce(
      mkResponse(400, {
        detail: 'model openai/gpt-5 already exists in the allowlist',
      }),
    )
    const client = new LiteLLMManagementClient(BASE, MASTER)
    await expect(
      client.generateKeyWithRotation({
        alias: 'a',
        models: ['openai/gpt-5'],
        maxBudget: 1,
      }),
    ).rejects.toMatchObject({ name: 'LiteLLMManagementError', status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no rotate
  })

  it('propagates 5xx without rotating', async () => {
    // 503 is retriable → exhausts MAX_POST_ATTEMPTS, then propagates.
    // No rotation is attempted (the rotation path only triggers on a
    // duplicate-alias 400, which is not retriable).
    fetchMock
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
      .mockResolvedValueOnce(mkResponse(503, 'upstream busy'))
    const client = new LiteLLMManagementClient(BASE, MASTER)
    const p = client.generateKeyWithRotation({
      alias: 'a',
      models: ['m'],
      maxBudget: 1,
    }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await p).toMatchObject({
      name: 'LiteLLMManagementError',
      status: 503,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('LiteLLMManagementError serialization (#354 round-9 audit)', () => {
  it("excludes bodySnippet from JSON.stringify so pino's err serializer does not leak it to CloudWatch", () => {
    const sensitiveBody =
      'sk-leaked-key-material-NEVER-LOG-this-could-be-a-future-LiteLLM-error-body'
    const err = new LiteLLMManagementError(
      '/key/generate returned 200',
      200,
      sensitiveBody,
      false,
    )
    const serialized = JSON.stringify(err)
    expect(serialized).not.toContain(sensitiveBody)
    expect(serialized).not.toContain('bodySnippet')
    // But the other fields ARE preserved — these are operationally
    // useful and don't carry response-body content.
    expect(serialized).toContain('LiteLLMManagementError')
    expect(serialized).toContain('"status":200')
    expect(serialized).toContain('"retriable":false')
  })

  it('keeps bodySnippet readable on the instance for in-process use (isDuplicateAliasError predicate)', () => {
    const err = new LiteLLMManagementError(
      '/key/generate returned 400',
      400,
      '{"detail":"key_alias already exists"}',
      false,
    )
    // Direct property access still works — only serialization is narrowed.
    expect(err.bodySnippet).toBe('{"detail":"key_alias already exists"}')
  })

  it("spread, Object.keys, and Object.entries all skip bodySnippet (round-11 non-enumerable upgrade)", () => {
    // Round-10 documented this as a limitation; round-11 closes it
    // by making bodySnippet non-enumerable via Object.defineProperty.
    // Spread / Object.keys / Object.entries all walk enumerable
    // own-properties only — so the field that holds raw LiteLLM
    // response text no longer reaches downstream loggers via the
    // "shallow-copy then stringify" pattern (sentry, datadog,
    // winston adapters, structured-clone, etc.).
    const sensitiveBody = 'sk-future-leak-NEVER-LOG'
    const err = new LiteLLMManagementError(
      'test',
      200,
      sensitiveBody,
      false,
    )
    // Spread no longer copies the field.
    const spread = { ...err }
    expect('bodySnippet' in spread).toBe(false)
    expect(JSON.stringify(spread)).not.toContain(sensitiveBody)
    // Object.keys / Object.entries don't enumerate it either.
    expect(Object.keys(err)).not.toContain('bodySnippet')
    expect(Object.entries(err).map(([k]) => k)).not.toContain('bodySnippet')
    // Direct read still works — `isDuplicateAliasError` and tests
    // depend on this.
    expect(err.bodySnippet).toBe(sensitiveBody)
    // JSON.stringify path also safe (toJSON narrows + non-enumerable
    // makes it doubly safe).
    expect(JSON.stringify(err)).not.toContain(sensitiveBody)
    expect(JSON.stringify(err)).not.toContain('bodySnippet')
  })
})

describe('LiteLLMManagementClient constructor', () => {
  it('rejects empty baseUrl', () => {
    expect(() => new LiteLLMManagementClient('', MASTER)).toThrow(/baseUrl/)
  })

  it('rejects empty masterKey', () => {
    expect(() => new LiteLLMManagementClient(BASE, '')).toThrow(/masterKey/)
  })
})
