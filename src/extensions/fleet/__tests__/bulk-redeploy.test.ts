import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock AWS SDK before importing the handler so the module-scope ECSClient
// instantiation hits our mock. Mirrors redeploy.test.ts / services.test.ts.
// Unlike redeploy.test.ts we dispatch by command __type instead of relying on
// strict call ORDER — bulk fans Describe out in chunks and rolls UpdateService
// with concurrency, so call order isn't deterministic.
const sendMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  ListServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'ListServicesCommand',
    input,
  })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
  UpdateServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'UpdateServiceCommand',
    input,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 'test', role: 'operator' } })),
}))

const mutationLimiterMock = vi.fn((_req: unknown) => null as unknown)
vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: (req: unknown) => mutationLimiterMock(req),
}))

const logSecurityEventMock = vi.fn()
vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: (e: unknown) => logSecurityEventMock(e),
}))

// ---- Fixtures (mutated per test, reset in beforeEach) ----

interface FakeService {
  serviceArn: string
  serviceName: string
  status: string
  tags: { key: string; value: string }[]
  taskDefinition: string
  deployments: { id: string; status: string }[]
}

const ARN_PREFIX =
  'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/'

const mkService = (
  name: string,
  opts: {
    harness?: boolean
    status?: string
    extraTags?: { key: string; value: string }[]
  } = {},
): FakeService => {
  const harness = opts.harness ?? true
  const tags = [
    ...(harness
      ? [
          { key: 'Component', value: 'agent-harness' },
          { key: 'ManagedBy', value: 'mission-control' },
        ]
      : [{ key: 'Component', value: 'platform-service' }]),
    ...(opts.extraTags ?? []),
  ]
  return {
    serviceArn: `${ARN_PREFIX}${name}`,
    serviceName: name,
    status: opts.status ?? 'ACTIVE',
    tags,
    taskDefinition: `arn:aws:ecs:us-east-1:111122223333:task-definition/ender-stack-dev-${name}:7`,
    deployments: [{ id: `dep-${name}`, status: 'PRIMARY' }],
  }
}

// Services the Describe dispatcher knows about (by arn OR name).
let registry: FakeService[] = []
// ListServices pages (each: serviceArns + optional nextToken).
let listPages: { serviceArns: string[]; nextToken?: string }[] = []
let listCallIdx = 0
// When set, every DescribeServices reports this failure (non-MISSING path).
let describeFailure: { arn?: string; reason?: string } | null = null
// When set, every UpdateService rejects with this error.
let updateError: Error | null = null

const nameOf = (s: FakeService, id: string) =>
  s.serviceArn === id || s.serviceName === id

beforeEach(() => {
  sendMock.mockReset()
  mutationLimiterMock.mockReset()
  mutationLimiterMock.mockReturnValue(null as unknown)
  logSecurityEventMock.mockReset()
  registry = []
  listPages = []
  listCallIdx = 0
  describeFailure = null
  updateError = null

  sendMock.mockImplementation(async (cmd: { __type: string; input: any }) => {
    if (cmd.__type === 'ListServicesCommand') {
      const page = listPages[listCallIdx] ?? { serviceArns: [] }
      listCallIdx += 1
      return { serviceArns: page.serviceArns, nextToken: page.nextToken }
    }
    if (cmd.__type === 'DescribeServicesCommand') {
      const ids: string[] = cmd.input.services ?? []
      const services: FakeService[] = []
      const failures: { arn?: string; reason?: string }[] = []
      if (describeFailure) failures.push(describeFailure)
      for (const id of ids) {
        const svc = registry.find((s) => nameOf(s, id))
        if (svc) services.push(svc)
        else failures.push({ arn: id, reason: 'MISSING' })
      }
      return { services, failures }
    }
    if (cmd.__type === 'UpdateServiceCommand') {
      if (updateError) throw updateError
      const name: string = cmd.input.service
      const svc = registry.find((s) => s.serviceName === name)
      return {
        service: {
          serviceName: name,
          taskDefinition:
            svc?.taskDefinition ??
            'arn:aws:ecs:us-east-1:111122223333:task-definition/x:1',
          deployments: [{ id: `dep-${name}`, status: 'PRIMARY' }],
        },
      }
    }
    throw new Error(`unexpected command ${cmd.__type}`)
  })
})

const importHandler = async () => (await import('../api/bulk-redeploy')).POST

const mkRequest = (body: unknown) =>
  ({
    url: 'http://localhost/api/fleet/bulk-redeploy',
    json: async () => body,
  }) as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]

const updateCalls = () =>
  sendMock.mock.calls.filter((c) => c[0]?.__type === 'UpdateServiceCommand')

describe('POST /api/fleet/bulk-redeploy — explicit mode', () => {
  it('rolls every explicit harness target and returns 202 with deployment ids', async () => {
    registry = [mkService('agent-a'), mkService('agent-b')]
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'explicit', services: ['agent-a', 'agent-b'] },
      }),
    )
    const body = await resp.json()

    expect(resp.status).toBe(202)
    expect(body.ok).toBe(true)
    expect(body.count).toBe(2)
    expect(body.results.map((r: any) => r.service).sort()).toEqual([
      'agent-a',
      'agent-b',
    ])
    expect(body.results.every((r: any) => r.ok && r.deploymentId)).toBe(true)

    // Two UpdateService calls, each carrying ONLY forceNewDeployment.
    expect(updateCalls()).toHaveLength(2)
    for (const c of updateCalls()) {
      expect(Object.keys(c[0].input).sort()).toEqual(
        ['cluster', 'forceNewDeployment', 'service'].sort(),
      )
      expect(c[0].input.forceNewDeployment).toBe(true)
    }
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('atomically rejects the whole batch (400) if any target is not a harness — zero UpdateService calls', async () => {
    registry = [mkService('agent-a'), mkService('litellm', { harness: false })]
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'explicit', services: ['agent-a', 'litellm'] },
      }),
    )
    const body = await resp.json()

    expect(resp.status).toBe(400)
    expect(body.error).toBe('NotAgentHarness')
    expect(body.services).toEqual(['litellm'])
    // Critical: NOT best-effort — nothing was rolled.
    expect(updateCalls()).toHaveLength(0)
  })

  it('rejects the whole batch (404) when any explicit target is missing/inactive', async () => {
    registry = [mkService('agent-a')]
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'explicit', services: ['agent-a', 'ghost'] },
      }),
    )
    const body = await resp.json()

    expect(resp.status).toBe(404)
    expect(body.error).toBe('ServiceNotFoundException')
    expect(body.services).toEqual(['ghost'])
    expect(updateCalls()).toHaveLength(0)
  })

  it('treats a DRAINING explicit target as not-found (404)', async () => {
    registry = [
      mkService('agent-a'),
      mkService('agent-b', { status: 'DRAINING' }),
    ]
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'explicit', services: ['agent-a', 'agent-b'] },
      }),
    )
    const body = await resp.json()
    expect(resp.status).toBe(404)
    expect(body.services).toEqual(['agent-b'])
    expect(updateCalls()).toHaveLength(0)
  })

  it('returns 502 (not 404) on a non-MISSING Describe failure', async () => {
    registry = [mkService('agent-a')]
    describeFailure = { arn: 'agent-a', reason: 'ACCESS_DENIED' }
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ filter: { mode: 'explicit', services: ['agent-a'] } }),
    )
    const body = await resp.json()
    expect(resp.status).toBe(502)
    expect(body.error).toBe('UpstreamServiceError')
    expect(updateCalls()).toHaveLength(0)
  })
})

describe('POST /api/fleet/bulk-redeploy — all / by-tag discovery', () => {
  it('all mode discovers across paginated ListServices, filters non-harness, rolls the rest', async () => {
    registry = [
      mkService('agent-a'),
      mkService('agent-b'),
      mkService('litellm', { harness: false }),
    ]
    listPages = [
      {
        serviceArns: [`${ARN_PREFIX}agent-a`, `${ARN_PREFIX}litellm`],
        nextToken: 'tok',
      },
      { serviceArns: [`${ARN_PREFIX}agent-b`] },
    ]
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    const body = await resp.json()

    expect(resp.status).toBe(202)
    expect(body.count).toBe(2)
    expect(body.results.map((r: any) => r.service).sort()).toEqual([
      'agent-a',
      'agent-b',
    ])
    // litellm (platform-service) never entered the batch.
    expect(updateCalls().map((c) => c[0].input.service)).not.toContain(
      'litellm',
    )
    // Both ListServices pages were fetched (nextToken loop).
    expect(
      sendMock.mock.calls.filter((c) => c[0]?.__type === 'ListServicesCommand'),
    ).toHaveLength(2)
  })

  it('by-tag mode further filters harnesses to the matching tag', async () => {
    registry = [
      mkService('agent-a', { extraTags: [{ key: 'Owner', value: 'andrew' }] }),
      mkService('agent-b', { extraTags: [{ key: 'Owner', value: 'andrew' }] }),
      mkService('agent-c'),
    ]
    listPages = [
      {
        serviceArns: [
          `${ARN_PREFIX}agent-a`,
          `${ARN_PREFIX}agent-b`,
          `${ARN_PREFIX}agent-c`,
        ],
      },
    ]
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'by-tag', tagKey: 'Owner', tagValue: 'andrew' },
      }),
    )
    const body = await resp.json()
    expect(resp.status).toBe(202)
    expect(body.count).toBe(2)
    expect(body.results.map((r: any) => r.service).sort()).toEqual([
      'agent-a',
      'agent-b',
    ])
  })

  it('returns 200 with empty results when the filter matches nothing', async () => {
    listPages = [{ serviceArns: [] }]
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    const body = await resp.json()
    expect(resp.status).toBe(200)
    expect(body.count).toBe(0)
    expect(body.results).toEqual([])
    expect(updateCalls()).toHaveLength(0)
  })
})

describe('POST /api/fleet/bulk-redeploy — confirmation gate', () => {
  const sixHarnesses = () => {
    const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
    registry = names.map((n) => mkService(n))
    listPages = [{ serviceArns: names.map((n) => `${ARN_PREFIX}${n}`) }]
    return names
  }

  it('requires the REDEPLOY-N-AGENTS token when count > 5', async () => {
    sixHarnesses()
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    const body = await resp.json()
    expect(resp.status).toBe(400)
    expect(body.error).toBe('ConfirmationRequired')
    expect(body.count).toBe(6)
    expect(body.expected).toBe('REDEPLOY-6-AGENTS')
    expect(updateCalls()).toHaveLength(0)
  })

  it('proceeds when the correct confirm token is supplied', async () => {
    sixHarnesses()
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ filter: { mode: 'all' }, confirm: 'REDEPLOY-6-AGENTS' }),
    )
    const body = await resp.json()
    expect(resp.status).toBe(202)
    expect(body.count).toBe(6)
    expect(updateCalls()).toHaveLength(6)
  })

  it('does not require confirmation at or below the threshold (5)', async () => {
    const names = ['a1', 'a2', 'a3', 'a4', 'a5']
    registry = names.map((n) => mkService(n))
    listPages = [{ serviceArns: names.map((n) => `${ARN_PREFIX}${n}`) }]
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    expect(resp.status).toBe(202)
    expect((await resp.json()).count).toBe(5)
  })
})

describe('POST /api/fleet/bulk-redeploy — per-service best-effort failures', () => {
  it('collects a failed UpdateService as ok:false without unwinding the batch', async () => {
    registry = [mkService('agent-a'), mkService('agent-b')]
    updateError = Object.assign(new Error('boom'), {
      name: 'AccessDeniedException',
    })
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        filter: { mode: 'explicit', services: ['agent-a', 'agent-b'] },
      }),
    )
    const body = await resp.json()
    // Pre-flight guard passed (both are harnesses) → 202 with per-service
    // failures redacted to UpstreamServiceError.
    expect(resp.status).toBe(202)
    expect(body.results.every((r: any) => r.ok === false)).toBe(true)
    expect(
      body.results.every((r: any) => r.error === 'UpstreamServiceError'),
    ).toBe(true)
  })
})

describe('POST /api/fleet/bulk-redeploy — input validation', () => {
  it('400s on an unknown mode', async () => {
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'nonsense' } }))
    expect(resp.status).toBe(400)
    expect((await resp.json()).error).toBe('InvalidRequestShape')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('400s on explicit mode with an empty services array', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ filter: { mode: 'explicit', services: [] } }),
    )
    expect(resp.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('400s on by-tag mode missing tagKey/tagValue', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ filter: { mode: 'by-tag', tagKey: 'Owner' } }),
    )
    expect(resp.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('accepts explicit mode with duplicate names that dedup under the cap', async () => {
    // The 200-cap is on the DEDUPED set: 201 copies of one valid name resolve
    // to a single target and must not be rejected as InvalidRequestShape.
    registry = [mkService('agent-a')]
    const POST = await importHandler()
    const dupes = Array.from({ length: 201 }, () => 'agent-a')
    const resp = await POST(
      mkRequest({ filter: { mode: 'explicit', services: dupes } }),
    )
    expect(resp.status).toBe(202)
    expect((await resp.json()).count).toBe(1)
  })

  it('400s on a non-JSON body', async () => {
    const POST = await importHandler()
    const bad = {
      url: 'http://localhost/api/fleet/bulk-redeploy',
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]
    const resp = await POST(bad)
    expect(resp.status).toBe(400)
    expect((await resp.json()).error).toBe('InvalidRequestBody')
  })
})

describe('POST /api/fleet/bulk-redeploy — auth + rate limit', () => {
  it('rejects viewer role (operator+ required), no SDK call', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Requires operator role or higher',
      status: 403,
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    expect(resp.status).toBe(403)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('short-circuits with the limiter 429 before any AWS call', async () => {
    const { NextResponse } = await import('next/server')
    mutationLimiterMock.mockReturnValueOnce(
      NextResponse.json({ error: 'Too many requests.' }, { status: 429 }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest({ filter: { mode: 'all' } }))
    expect(resp.status).toBe(429)
    // The handler stamps no-store onto the limiter's 429 so no mutating
    // response path is cacheable.
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
    expect(sendMock).not.toHaveBeenCalled()
  })
})
