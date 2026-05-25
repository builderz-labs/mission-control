import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the AWS SDK before importing the handler so the module-scope
// ECSClient instantiation hits our mock. Each test sets the desired
// per-call mock behaviour via the shared `sendMock`.
const sendMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => {
  return {
    ECSClient: vi.fn().mockImplementation(() => ({
      send: sendMock,
    })),
    ListServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: 'ListServicesCommand',
      input,
    })),
    DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: 'DescribeServicesCommand',
      input,
    })),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}))

// Stub auth — every test below assumes a viewer (or higher) caller.
// One additional test exercises the auth-rejection branch directly.
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 'test', role: 'viewer' } })),
}))

const importHandler = async () => {
  const mod = await import('../api/services')
  return mod.GET
}

// Minimal NextRequest stub. Handler reads `url` only for the auth gate
// path-resolution; query params are no longer consulted (filter is
// always-on, server-side).
const mkRequest = () =>
  ({ url: 'http://localhost/api/fleet/services' }) as unknown as Parameters<
    Awaited<ReturnType<typeof importHandler>>
  >[0]

beforeEach(() => {
  sendMock.mockReset()
})

describe('GET /api/fleet/services', () => {
  it('returns empty services list when ListServices returns no ARNs', async () => {
    sendMock.mockResolvedValueOnce({ serviceArns: [] })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(body.services).toEqual([])
    expect(body.cluster).toBeDefined()
    expect(body.region).toBeDefined()
    expect(body.truncated).toBe(false)
    // Only ListServices was called — no Describe needed for empty list
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('summarizes harness-tagged services and excludes platform services', async () => {
    // Server-side filter is always-on: only services tagged
    // Component=agent-harness pass through. Platform services (LiteLLM, MC,
    // etc.) carry Component=platform-service and are excluded by design —
    // Fleet is the agent-control-plane page, not a cluster-wide inventory.
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-companion-openclaw-smoke-test',
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-companion-openclaw-mid-rollout',
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-litellm',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-companion-openclaw-smoke-test',
          serviceName: 'ender-stack-dev-companion-openclaw-smoke-test',
          status: 'ACTIVE',
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          taskDefinition: 'arn:aws:ecs:...:task-definition/ender-stack-dev-companion-openclaw-smoke-test:1',
          launchType: 'FARGATE',
          // Steady-state PRIMARY only — activeDeployments should be 0
          deployments: [{ id: 'ecs-svc/1', rolloutState: 'COMPLETED' }],
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-companion-openclaw-mid-rollout',
          serviceName: 'ender-stack-dev-companion-openclaw-mid-rollout',
          status: 'ACTIVE',
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          taskDefinition: 'arn:aws:ecs:...:task-definition/ender-stack-dev-companion-openclaw-mid-rollout:7',
          launchType: 'FARGATE',
          // Mid-rollout — IN_PROGRESS deployment should be counted
          deployments: [
            { id: 'ecs-svc/2-old', rolloutState: 'COMPLETED' },
            { id: 'ecs-svc/2-new', rolloutState: 'IN_PROGRESS' },
          ],
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
        {
          // Platform service — must be filtered out
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/ender-stack-dev-litellm',
          serviceName: 'ender-stack-dev-litellm',
          status: 'ACTIVE',
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          launchType: 'FARGATE',
          deployments: [{ rolloutState: 'COMPLETED' }],
          tags: [{ key: 'Component', value: 'platform-service' }],
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    // Only the 2 harness-tagged services pass; LiteLLM filtered out.
    expect(body.services).toHaveLength(2)
    expect(body.services[0].name).toBe('ender-stack-dev-companion-openclaw-smoke-test')
    expect(body.services[0].status).toBe('ACTIVE')
    expect(body.services[0].runningCount).toBe(1)
    // Steady-state COMPLETED deployment is NOT counted as active
    expect(body.services[0].activeDeployments).toBe(0)
    expect(body.services[1].name).toBe('ender-stack-dev-companion-openclaw-mid-rollout')
    // Mid-rollout — only the IN_PROGRESS entry counts
    expect(body.services[1].activeDeployments).toBe(1)
    // Platform-service tagged service is absent
    expect(body.services.find((s: { name: string }) => s.name.includes('litellm'))).toBeUndefined()
    expect(body.truncated).toBe(false)
  })

  it('excludes services with no Component tag (untagged services are not agents)', async () => {
    // New ECS modules that forget to tag should NOT appear in Fleet — same
    // semantic as platform-service (not an agent). Forces the convention
    // that Fleet entries are explicitly opted-in via Component=agent-harness.
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/untagged-svc',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/untagged-svc',
          serviceName: 'untagged-svc',
          status: 'ACTIVE',
          deployments: [],
          // No tags array at all
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(body.services).toHaveLength(0)
  })

  it('returns 502 with redacted error name (no detail) on AWS error', async () => {
    const awsError = Object.assign(
      new Error(
        'User: arn:aws:sts::111122223333:assumed-role/mc/sess is not authorized',
      ),
      { name: 'AccessDeniedException' },
    )
    sendMock.mockRejectedValueOnce(awsError)

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(502)
    // ender-stack#274: raw AWS error name redacted in the client-facing body.
    expect(body.error).toBe('UpstreamServiceError')
    expect(body.error).not.toBe('AccessDeniedException')
    // detail must NOT be in the response — AWS error messages embed
    // caller ARN / account ID / cluster ARN. Server-side log captures it.
    expect(body.detail).toBeUndefined()
    // ender-stack#278: 502 error path now carries Cache-Control: no-store.
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('chunks DescribeServices calls when more than 10 service ARNs', async () => {
    // Generate 12 ARNs to force the chunking branch (cap of 10 per Describe)
    const arns = Array.from(
      { length: 12 },
      (_, i) =>
        `arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-${i}`,
    )
    sendMock.mockResolvedValueOnce({ serviceArns: arns })

    // Two DescribeServices chunks
    const harnessTags = [{ key: 'Component', value: 'agent-harness' }]
    sendMock.mockResolvedValueOnce({
      services: arns.slice(0, 10).map((arn, i) => ({
        serviceArn: arn,
        serviceName: `svc-${i}`,
        status: 'ACTIVE',
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
        deployments: [{ rolloutState: 'COMPLETED' }],
        tags: harnessTags,
      })),
    })
    sendMock.mockResolvedValueOnce({
      services: arns.slice(10).map((arn, i) => ({
        serviceArn: arn,
        serviceName: `svc-${i + 10}`,
        status: 'ACTIVE',
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
        deployments: [{ rolloutState: 'COMPLETED' }],
        tags: harnessTags,
      })),
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    // All 12 services tagged as agent-harness pass the always-on filter.
    expect(body.services).toHaveLength(12)
    // 1 ListServices + 2 DescribeServices (run in parallel via Promise.all)
    // = 3 SDK calls.
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  it('strips the account-id-bearing prefix from the task-definition ARN', async () => {
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc',
          serviceName: 'svc',
          status: 'ACTIVE',
          taskDefinition:
            'arn:aws:ecs:us-east-1:111122223333:task-definition/ender-stack-dev-svc:7',
          deployments: [],
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    // Should be just `family:revision`, NOT the full ARN
    expect(body.services[0].taskDefinition).toBe('ender-stack-dev-svc:7')
    expect(body.services[0].taskDefinition).not.toContain('111122223333')
    expect(body.services[0].taskDefinition).not.toContain('arn:aws')
  })

  it('logs DescribeServices.failures via logger.warn AND returns surviving services', async () => {
    // TOCTOU window: ListServices returned both ARNs, but by the time
    // DescribeServices ran, svc-deleted was gone. The handler should log
    // the failure AND continue to surface the surviving service in the
    // response body (not 502).
    const { logger } = await import('@/lib/logger')
    const warnSpy = vi.mocked(logger.warn)
    warnSpy.mockClear()

    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-alive',
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-deleted',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-alive',
          serviceName: 'svc-alive',
          status: 'ACTIVE',
          deployments: [],
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
      ],
      failures: [
        {
          arn: 'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-deleted',
          reason: 'MISSING',
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ reason: 'MISSING' }),
        ]),
      }),
      expect.stringContaining('DescribeServices reported per-ARN failures'),
    )
    // Surviving service still surfaces — partial failure ≠ 502
    expect(resp.status).toBe(200)
    expect(body.services).toHaveLength(1)
    expect(body.services[0].name).toBe('svc-alive')
  })

  it('does NOT mark truncated when AWS returns no nextToken (boundary case)', async () => {
    // Exactly 100 ARNs but no nextToken — cluster has exactly 100 services,
    // not truncated. (Earlier count-based heuristic produced a false positive.)
    const arns = Array.from(
      { length: 100 },
      (_, i) =>
        `arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-${i}`,
    )
    sendMock.mockResolvedValueOnce({ serviceArns: arns /* no nextToken */ })
    // 10 chunks of 10 — return one stub service per chunk so the test
    // doesn't have to materialize 100 service objects.
    for (let i = 0; i < 10; i++) {
      sendMock.mockResolvedValueOnce({ services: [] })
    }

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(body.truncated).toBe(false)
  })

  it('marks response truncated when AWS returns a nextToken', async () => {
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-0',
      ],
      nextToken: 'opaque-cursor-string',
    })
    sendMock.mockResolvedValueOnce({ services: [] })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(body.truncated).toBe(true)
  })
})

describe('GET /api/fleet/services — DescribeServices wiring', () => {
  it('passes include:[TAGS] to DescribeServices so tags are returned', async () => {
    // Without include:[TAGS], the Service response omits the tags array
    // entirely and the always-on filter would silently return zero
    // services. This is the wiring assertion.
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-1',
      ],
    })
    sendMock.mockResolvedValueOnce({ services: [] })

    const GET = await importHandler()
    await GET(mkRequest())

    // Second send call is DescribeServices; assert it carried include:['TAGS']
    const describeCall = sendMock.mock.calls[1][0]
    expect(describeCall.input.include).toEqual(['TAGS'])
  })
})

describe('GET /api/fleet/services — auth gate', () => {
  it('returns the auth error response when requireRole rejects', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Authentication required',
      status: 401,
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(401)
    expect(body.error).toBe('Authentication required')
    // No SDK calls when auth rejects
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/fleet/services — per-call timeout (ender-stack#280)', () => {
  it('passes an abortSignal as the 2nd arg to ListServices + each DescribeServices', async () => {
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-0',
      ],
    })
    sendMock.mockResolvedValueOnce({ services: [] })

    const GET = await importHandler()
    await GET(mkRequest())

    // Both the ListServices call and the DescribeServices chunk carry a signal.
    for (const call of sendMock.mock.calls) {
      const opts = call[1] as { abortSignal?: AbortSignal } | undefined
      expect(opts?.abortSignal).toBeInstanceOf(AbortSignal)
    }
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})

describe('GET /api/fleet/services — failure classification (ender-stack#281)', () => {
  it('returns 502 UpstreamServiceError on a non-MISSING (denial) failure', async () => {
    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-denied',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [],
      failures: [
        {
          arn: 'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-denied',
          reason: 'AccessDenied',
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    expect(resp.status).toBe(502)
    expect(body.error).toBe('UpstreamServiceError')
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('preserves the existing MISSING behavior (warn + surface surviving services)', async () => {
    const { logger } = await import('@/lib/logger')
    const warnSpy = vi.mocked(logger.warn)
    warnSpy.mockClear()

    sendMock.mockResolvedValueOnce({
      serviceArns: [
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-alive',
        'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-deleted',
      ],
    })
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-alive',
          serviceName: 'svc-alive',
          status: 'ACTIVE',
          deployments: [],
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
      ],
      failures: [
        {
          arn: 'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-deleted',
          reason: 'MISSING',
        },
      ],
    })

    const GET = await importHandler()
    const resp = await GET(mkRequest())
    const body = await resp.json()

    // MISSING is benign: 200 + surviving service surfaced, warn logged.
    expect(resp.status).toBe(200)
    expect(body.services).toHaveLength(1)
    expect(body.services[0].name).toBe('svc-alive')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ reason: 'MISSING' }),
        ]),
      }),
      expect.stringContaining('DescribeServices reported per-ARN failures'),
    )
  })
})
