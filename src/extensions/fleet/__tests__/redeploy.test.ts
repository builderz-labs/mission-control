import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock AWS SDK before importing the handler so the module-scope ECSClient
// instantiation hits our mock. Mirrors the services.test.ts setup.
const sendMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => {
  return {
    ECSClient: vi.fn().mockImplementation(() => ({
      send: sendMock,
    })),
    DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: 'DescribeServicesCommand',
      input,
    })),
    UpdateServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: 'UpdateServiceCommand',
      input,
    })),
  }
})

// Helper for the Describe pre-flight mock — every redeploy hits ECS twice
// now (Describe → UpdateService) so the IAM cluster-scope can't be the
// only boundary keeping operators away from platform services.
const mkActiveAgentDescribe = (name: string) => ({
  services: [
    {
      serviceName: name,
      status: 'ACTIVE',
      tags: [{ key: 'Component', value: 'agent-harness' }],
    },
  ],
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}))

// Stub auth — every test below assumes an operator (or higher) caller.
// One additional test exercises the auth-rejection branch directly.
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 'test', role: 'operator' } })),
}))

const importHandler = async () => {
  const mod = await import('../api/redeploy')
  return mod.POST
}

const mkRequest = () =>
  ({ url: 'http://localhost/api/fleet/services/svc/redeploy' }) as unknown as Parameters<
    Awaited<ReturnType<typeof importHandler>>
  >[0]

const mkParams = (name: string) =>
  ({ params: Promise.resolve({ name }) }) as unknown as Parameters<
    Awaited<ReturnType<typeof importHandler>>
  >[1]

beforeEach(() => {
  sendMock.mockReset()
})

describe('POST /api/fleet/services/:name/redeploy', () => {
  it('issues UpdateService with forceNewDeployment=true and returns 202', async () => {
    // Describe pre-flight: confirms target is harness-tagged
    sendMock.mockResolvedValueOnce(mkActiveAgentDescribe('svc-1'))
    // UpdateService response
    sendMock.mockResolvedValueOnce({
      service: {
        serviceArn:
          'arn:aws:ecs:us-east-1:111122223333:service/ender-stack-dev/svc-1',
        serviceName: 'svc-1',
        taskDefinition:
          'arn:aws:ecs:us-east-1:111122223333:task-definition/ender-stack-dev-svc-1:42',
        deployments: [
          { id: 'ecs-svc/new', status: 'PRIMARY', rolloutState: 'IN_PROGRESS' },
          { id: 'ecs-svc/old', status: 'ACTIVE', rolloutState: 'COMPLETED' },
        ],
      },
    })

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    const body = await resp.json()

    expect(resp.status).toBe(202)
    expect(body.ok).toBe(true)
    // Newest deployment ID returned for cross-referencing CloudTrail
    expect(body.deploymentId).toBe('ecs-svc/new')
    // Task-def stripped to family:revision (no account ID)
    expect(body.taskDefinition).toBe('ender-stack-dev-svc-1:42')
    expect(body.taskDefinition).not.toContain('111122223333')

    // Two SDK calls: Describe pre-flight + UpdateService
    expect(sendMock).toHaveBeenCalledTimes(2)
    const describeCall = sendMock.mock.calls[0][0]
    expect(describeCall.input.include).toEqual(['TAGS'])
    expect(describeCall.input.services).toEqual(['svc-1'])
    const updateCall = sendMock.mock.calls[1][0]
    expect(updateCall.input.cluster).toBe('ender-stack-dev')
    expect(updateCall.input.service).toBe('svc-1')
    expect(updateCall.input.forceNewDeployment).toBe(true)
    // CRITICAL: only forceNewDeployment is forwarded — no other fields.
    // Auditor #187 flagged that IAM can't restrict UpdateService params,
    // so the handler is the only thing keeping a compromised caller from
    // scaling-to-zero or swapping the task def.
    expect(Object.keys(updateCall.input).sort()).toEqual(
      ['cluster', 'forceNewDeployment', 'service'].sort(),
    )
  })

  it('refuses to redeploy a non-harness service (404, no UpdateService call)', async () => {
    // Defense-in-depth on top of IAM. The cluster-scoped grant permits
    // UpdateService on any service in the cluster — including platform
    // services like LiteLLM and MC itself. Pre-flight checks the tag and
    // 404s if it doesn't match. 404 (not 403) intentionally: refuses to
    // confirm the existence of a non-harness service to a probe.
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceName: 'ender-stack-dev-litellm',
          status: 'ACTIVE',
          tags: [{ key: 'Component', value: 'platform-service' }],
        },
      ],
    })

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('ender-stack-dev-litellm'))
    const body = await resp.json()

    expect(resp.status).toBe(404)
    expect(body.error).toBe('ServiceNotFoundException')
    // Crucially: only the Describe call fired, NOT UpdateService
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('refuses to redeploy untagged services (no Component tag → not an agent)', async () => {
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceName: 'ender-stack-dev-someone-forgot-the-tag',
          status: 'ACTIVE',
          // No tags array
        },
      ],
    })

    const POST = await importHandler()
    const resp = await POST(
      mkRequest(),
      mkParams('ender-stack-dev-someone-forgot-the-tag'),
    )
    const body = await resp.json()

    expect(resp.status).toBe(404)
    expect(body.error).toBe('ServiceNotFoundException')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when Describe shows the service as DRAINING/INACTIVE', async () => {
    // Stale UI / mid-decommission. Same 404 shape as ServiceNotFoundException
    // and not-a-harness — uniform response prevents probing for service
    // state via timing.
    sendMock.mockResolvedValueOnce({
      services: [
        {
          serviceName: 'svc-draining',
          status: 'DRAINING',
          tags: [{ key: 'Component', value: 'agent-harness' }],
        },
      ],
    })

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-draining'))
    const body = await resp.json()

    expect(resp.status).toBe(404)
    expect(body.error).toBe('ServiceNotFoundException')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the pre-flight Describe finds no matching service', async () => {
    sendMock.mockResolvedValueOnce({ services: [] })

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-typo'))
    const body = await resp.json()

    expect(resp.status).toBe(404)
    expect(body.error).toBe('ServiceNotFoundException')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('returns 502 with SDK error name only on AccessDeniedException', async () => {
    // Surfaces during initial deploy if the IAM grant from ender-stack
    // PR #187 isn't applied yet. The Describe call would also fail with
    // AccessDenied since DescribeServices was already in the read grant —
    // simulating the harder failure mode where the read works but
    // UpdateService is denied (the actual scenario when only #187's
    // write-grant is missing).
    sendMock.mockResolvedValueOnce(mkActiveAgentDescribe('svc-1'))
    const awsError = Object.assign(
      new Error(
        'User: arn:aws:sts::111122223333:assumed-role/mc/sess is not authorized to perform: ecs:UpdateService',
      ),
      { name: 'AccessDeniedException' },
    )
    sendMock.mockRejectedValueOnce(awsError)

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    const body = await resp.json()

    expect(resp.status).toBe(502)
    expect(body.error).toBe('AccessDeniedException')
    expect(body.detail).toBeUndefined()
  })

  it('encodes service name into UpdateService.service param without alteration', async () => {
    sendMock.mockResolvedValueOnce(
      mkActiveAgentDescribe('ender-stack-dev-companion-openclaw-smoke-test'),
    )
    sendMock.mockResolvedValueOnce({
      service: {
        serviceName: 'ender-stack-dev-companion-openclaw-smoke-test',
        taskDefinition:
          'arn:aws:ecs:us-east-1:111122223333:task-definition/x:1',
        deployments: [],
      },
    })

    const POST = await importHandler()
    await POST(
      mkRequest(),
      mkParams('ender-stack-dev-companion-openclaw-smoke-test'),
    )

    const updateCall = sendMock.mock.calls[1][0]
    expect(updateCall.input.service).toBe(
      'ender-stack-dev-companion-openclaw-smoke-test',
    )
  })
})

describe('POST /api/fleet/services/:name/redeploy — auth gate', () => {
  it('rejects viewer role (operator+ required)', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Requires operator role or higher',
      status: 403,
    })

    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    const body = await resp.json()

    expect(resp.status).toBe(403)
    expect(body.error).toBe('Requires operator role or higher')
    // No SDK call when auth rejects — important for the surface-area
    // guarantee of the operator role gate.
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/fleet/services/:name/redeploy — Cache-Control: no-store on every response (PR #53 round-3)', () => {
  // Pin the no-store header on each response path. Round-3
  // audit caught that redeploy.test.ts had zero Cache-Control
  // assertions while the other 3 fleet handlers in the sweep
  // all do. Future refactor could silently re-introduce the
  // caching bug here without a failing test.
  const assertNoStore = (resp: Response) => {
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  }

  it('202 success path sets Cache-Control: no-store', async () => {
    sendMock.mockResolvedValueOnce(mkActiveAgentDescribe('svc-1'))
    sendMock.mockResolvedValueOnce({
      service: {
        taskDefinition: 'arn:aws:ecs:us-east-1:111:task-definition/foo:1',
        deployments: [{ id: 'd1', status: 'PRIMARY' }],
      },
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    expect(resp.status).toBe(202)
    assertNoStore(resp)
  })

  it('403 auth-error path sets Cache-Control: no-store', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Requires operator role or higher',
      status: 403,
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    expect(resp.status).toBe(403)
    assertNoStore(resp)
  })

  it('404 service-not-found sets Cache-Control: no-store', async () => {
    sendMock.mockResolvedValueOnce({ services: [] })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    expect(resp.status).toBe(404)
    assertNoStore(resp)
  })

  it('502 catch path sets Cache-Control: no-store', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('aws boom'), { name: 'AccessDeniedException' }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('svc-1'))
    expect(resp.status).toBe(502)
    assertNoStore(resp)
  })
})
