import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const ecsSendMock = vi.fn()
const elbv2SendMock = vi.fn()
const logsSendMock = vi.fn()
const smSendMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
  RegisterTaskDefinitionCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'RegisterTaskDefinitionCommand',
    input,
  })),
  CreateServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateServiceCommand',
    input,
  })),
}))

vi.mock('@aws-sdk/client-elastic-load-balancing-v2', () => ({
  ElasticLoadBalancingV2Client: vi
    .fn()
    .mockImplementation(() => ({ send: elbv2SendMock })),
  CreateTargetGroupCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateTargetGroupCommand',
    input,
  })),
  CreateRuleCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateRuleCommand',
    input,
  })),
  DescribeLoadBalancersCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeLoadBalancersCommand',
    input,
  })),
  DescribeListenersCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeListenersCommand',
    input,
  })),
  DescribeRulesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeRulesCommand',
    input,
  })),
}))

vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi
    .fn()
    .mockImplementation(() => ({ send: logsSendMock })),
  CreateLogGroupCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateLogGroupCommand',
    input,
  })),
  PutRetentionPolicyCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutRetentionPolicyCommand',
    input,
  })),
}))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi
    .fn()
    .mockImplementation(() => ({ send: smSendMock })),
  GetSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'GetSecretValueCommand',
    input,
  })),
  CreateSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateSecretCommand',
    input,
  })),
  PutSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutSecretValueCommand',
    input,
  })),
  DeleteSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteSecretCommand',
    input,
  })),
  // Round-10 audit hygiene: included so any future test that primes
  // a PendingDeletion → RestoreSecret path doesn't fail with a
  // "not a constructor" error. Not exercised by current tests.
  RestoreSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'RestoreSecretCommand',
    input,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 'test', role: 'admin' } })),
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

const importHandler = async () => {
  const mod = await import('../api/agents')
  return mod.POST
}

const setRequiredEnv = () => {
  process.env.AWS_REGION = 'us-east-1'
  process.env.MC_FLEET_CLUSTER_NAME = 'ender-stack-dev'
  process.env.MC_FLEET_PROJECT_NAME = 'ender-stack'
  process.env.MC_FLEET_ENVIRONMENT = 'dev'
  process.env.MC_AGENT_TASK_ROLE_ARN =
    'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-mc-task'
  process.env.MC_AGENT_EXECUTION_ROLE_ARN =
    'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-mc-exec'
  process.env.MC_AGENT_LOG_GROUP_PREFIX = '/ecs/ender-stack-dev'
  process.env.MC_AGENT_VPC_ID = 'vpc-abc'
  process.env.MC_AGENT_SUBNET_IDS = 'subnet-1,subnet-2'
  process.env.MC_AGENT_SECURITY_GROUP_ID = 'sg-ecs'
  process.env.MC_LITELLM_ALB_DNS_NAME = 'internal-litellm.us-east-1.elb.amazonaws.com'
  // #354: MC reads master key for /key/generate; writes per-agent
  // virtual key under the agent-secrets prefix.
  process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN =
    'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/litellm-master-key-AbC123'
  process.env.MC_AGENT_SECRETS_NAME_PREFIX =
    'ender-stack/dev/companion-openclaw'
}

const validBody = () => ({
  harnessType: 'companion/openclaw',
  agentName: 'hello-bot',
  roleDescription: 'Says hello',
  image: 'ghcr.io/stroupaloop/openclaw:sha-abc123',
})

const mkRequest = (body: unknown) =>
  ({
    json: async () => body,
    url: 'http://localhost/api/fleet/agents',
  }) as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]

// #354: response helper for the LiteLLM /key/generate fetch.
const mkLiteLLMKeyResponse = (key = 'sk-virtual-agent-NEVER-LOG') =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ key }),
    json: async () => ({ key }),
  }) as unknown as Response

/**
 * #354 round-12: prime step 0.4 (DescribeServices conflict
 * pre-flight). Returns an empty `services` array — no ACTIVE
 * service exists with this name → handler proceeds to step 0.5.
 *
 * Use in tests that bypass happyPathMocks / litellmStep05Mocks
 * but expect the handler to reach step 0.5 or beyond.
 */
const primeStep04NoConflict = () => {
  ecsSendMock.mockResolvedValueOnce({ services: [] })
}

/**
 * #354: prime smSendMock + fetchMock so step 0.5 (LiteLLM
 * /key/generate + write per-agent secret) succeeds. Used by any
 * test that bypasses happyPathMocks() but still expects a 201.
 *
 * Also primes step 0.4 (DescribeServices conflict pre-flight,
 * #354 round-12 fix): an empty `services` array means no ACTIVE
 * service exists with this name → proceed to step 0.5.
 */
const litellmStep05Mocks = (
  perAgentSecretArn = 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-litellm-key-XyZ789',
) => {
  // Step 0.4: DescribeServices for conflict check (#354 round-12).
  ecsSendMock.mockResolvedValueOnce({ services: [] })
  smSendMock
    .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
    .mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    .mockResolvedValueOnce({ ARN: perAgentSecretArn })
  fetchMock.mockResolvedValueOnce(mkLiteLLMKeyResponse())
}

const happyPathMocks = () => {
  // Order: DescribeServices (conflict pre-flight) → GetSecretValue
  // (master) → fetch /key/generate → PutSecretValue (or CreateSecret)
  // for per-agent key → DescribeLBs → DescribeListeners →
  // CreateLogGroup → PutRetentionPolicy → RegisterTaskDef →
  // CreateTargetGroup → DescribeRules (priority allocation) →
  // CreateRule → CreateService.
  elbv2SendMock.mockReset()
  ecsSendMock.mockReset()
  logsSendMock.mockReset()
  smSendMock.mockReset()
  fetchMock.mockReset()

  // #354 round-12: step 0.4 DescribeServices pre-flight conflict
  // check. Empty services array = no ACTIVE service → proceed.
  ecsSendMock.mockResolvedValueOnce({ services: [] })

  // #354: SecretsManager call sequence — master-key read,
  // then per-agent virtual-key write. writeAgentLiteLLMKey
  // uses Put-or-Create (Put first); first-time path Put
  // returns ResourceNotFoundException → fall through to
  // CreateSecret. Three SDK calls total.
  smSendMock
    .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
    .mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    .mockResolvedValueOnce({
      ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-litellm-key-XyZ789',
    })

  // #354: LiteLLM /key/generate returns the new virtual key.
  fetchMock.mockResolvedValueOnce(mkLiteLLMKeyResponse())

  elbv2SendMock
    .mockResolvedValueOnce({
      LoadBalancers: [
        {
          LoadBalancerArn:
            'arn:aws:elasticloadbalancing:us-east-1:398152419239:loadbalancer/app/ender-stack-dev-agents-shared/abc',
        },
      ],
    })
    .mockResolvedValueOnce({
      Listeners: [
        {
          ListenerArn:
            'arn:aws:elasticloadbalancing:us-east-1:398152419239:listener/app/ender-stack-dev-agents-shared/abc/lst1',
          Protocol: 'HTTP',
        },
      ],
    })
    .mockResolvedValueOnce({
      TargetGroups: [
        {
          TargetGroupArn:
            'arn:aws:elasticloadbalancing:us-east-1:398152419239:targetgroup/ender-stack-dev-agent-hello-bot/tg1',
        },
      ],
    })
    .mockResolvedValueOnce({
      // DescribeRules — empty listener (no occupied priorities), so
      // allocatePriority returns the hashed slot directly.
      Rules: [{ Priority: 'default' }],
    })
    .mockResolvedValueOnce({
      Rules: [
        {
          RuleArn:
            'arn:aws:elasticloadbalancing:us-east-1:398152419239:listener-rule/app/ender-stack-dev-agents-shared/abc/lst1/r1',
        },
      ],
    })

  logsSendMock
    .mockResolvedValueOnce({}) // CreateLogGroup
    .mockResolvedValueOnce({}) // PutRetentionPolicy

  ecsSendMock
    .mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn:
          'arn:aws:ecs:us-east-1:398152419239:task-definition/ender-stack-dev-companion-openclaw-hello-bot:1',
      },
    })
    .mockResolvedValueOnce({
      service: {
        serviceArn:
          'arn:aws:ecs:us-east-1:398152419239:service/ender-stack-dev/ender-stack-dev-companion-openclaw-hello-bot',
      },
    })
}

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
  elbv2SendMock.mockReset()
  logsSendMock.mockReset()
  smSendMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/fleet/agents — env validation', () => {
  it('returns 500 ConfigurationError when MC_AGENT_TASK_ROLE_ARN is unset', async () => {
    delete process.env.MC_AGENT_TASK_ROLE_ARN
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ConfigurationError')
    expect(json.detail).toContain('MC_AGENT_TASK_ROLE_ARN')
  })

  it('returns 500 with all missing env vars listed', async () => {
    delete process.env.MC_AGENT_VPC_ID
    delete process.env.MC_AGENT_SECURITY_GROUP_ID
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    const json = (await resp.json()) as { detail?: string }
    expect(json.detail).toContain('MC_AGENT_VPC_ID')
    expect(json.detail).toContain('MC_AGENT_SECURITY_GROUP_ID')
  })

  it('returns 500 ConfigurationError when MC_FLEET_IMAGE_REGISTRY_ALLOWLIST contains an invalid regex (not a 502 SyntaxError)', async () => {
    // Audit on PR #37 round 3 caught this: a malformed allowlist entry
    // would throw SyntaxError from `new RegExp()`, the outer try/catch
    // would surface it as a generic 502, and the operator would
    // diagnose a downstream AWS issue instead of fixing their env var.
    // The handler now maps ImageAllowlistConfigError to 500
    // ConfigurationError with the bad pattern named.
    const original = process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST
    process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST = '[unterminated-class'
    try {
      const POST = await importHandler()
      const resp = await POST(mkRequest(validBody()))
      expect(resp.status).toBe(500)
      const json = (await resp.json()) as { error: string; detail?: string }
      expect(json.error).toBe('ConfigurationError')
      expect(json.detail).toContain('MC_FLEET_IMAGE_REGISTRY_ALLOWLIST')
      expect(json.detail).toContain('[unterminated-class')
    } finally {
      if (original === undefined) {
        delete process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST
      } else {
        process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST = original
      }
    }
  })

  it('returns 400 ValidationError when the resulting target-group name would exceed AWS 32-char limit (round-3b.2)', async () => {
    // Real failure mode that bit operators in dev: a name like
    // `260501-test1` (12 chars) passes the regex but produces a
    // target-group name `ender-stack-dev-agent-260501-test1` (34
    // chars) which AWS rejects AFTER task-def + log group are
    // created — orphaning real billed resources. Pre-check fails
    // fast with a clear 400 + no AWS calls made.
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), agentName: 'agent-name-too-long' }),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ValidationError')
    expect(json.detail).toContain('target group name')
    expect(json.detail).toContain('agent-name-too-long')
    expect(json.detail).toMatch(/Max agentName length here is \d+/)
    // Round-10 audit P3: the "no orphaned resources" guarantee is
    // load-bearing — the whole point of this pre-check. Assert
    // explicitly so a regression that makes the pre-check fire
    // AFTER any AWS call would fail loudly here.
    expect(elbv2SendMock).not.toHaveBeenCalled()
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(logsSendMock).not.toHaveBeenCalled()
  })

  it('rejects agentName with invalid characters at the type-guard layer (defense-in-depth)', async () => {
    // Length window passes (11 chars, in [3,32]) but the regex fails
    // on the space. Confirms that even if a future harness's
    // validateInput drops the regex, the type guard catches it.
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), agentName: 'hello world' }),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('InvalidRequestShape')
  })
})

describe('POST /api/fleet/agents — request validation', () => {
  it('returns 400 InvalidRequestBody on non-JSON', async () => {
    const POST = await importHandler()
    const req = {
      json: async () => {
        throw new SyntaxError('bad json')
      },
    } as unknown as Parameters<typeof POST>[0]
    const resp = await POST(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { error: string }).error).toBe(
      'InvalidRequestBody',
    )
  })

  it('returns 400 InvalidRequestShape when fields are missing', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ harnessType: 'companion/openclaw', agentName: 'hi' }),
    )
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { error: string }).error).toBe(
      'InvalidRequestShape',
    )
  })

  it('returns 400 InvalidRequestShape when agentName fails the regex (caught at type guard)', async () => {
    // After auditor round 5, the regex moved into isCreateAgentRequest
    // as the harness-agnostic security boundary, so invalid agent names
    // are caught here BEFORE the template's validateInput sees them.
    // Both layers still apply the same regex (defense-in-depth).
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), agentName: 'BAD_NAME' }),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('InvalidRequestShape')
  })

  it('returns 400 InvalidRequestShape on unknown harnessType', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), harnessType: 'task/hermes' }),
    )
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { error: string }).error).toBe(
      'InvalidRequestShape',
    )
  })
})

describe('POST /api/fleet/agents — auth', () => {
  it('rejects non-admin callers via requireRole', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'forbidden',
      status: 403,
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(403)
  })
})

describe('POST /api/fleet/agents — happy path', () => {
  it('returns 201 with all created resource ARNs', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
    const json = (await resp.json()) as {
      ok: boolean
      agentName: string
      resources: {
        serviceArn: string
        taskDefinitionArn: string
        targetGroupArn: string
        listenerRuleArn: string
        logGroup: string
        listenerPath: string
      }
    }
    expect(json.ok).toBe(true)
    expect(json.agentName).toBe('hello-bot')
    expect(json.resources.listenerPath).toBe(
      '/agent/hello-bot (+ /agent/hello-bot/*)',
    )
    expect(json.resources.logGroup).toBe(
      '/ecs/ender-stack-dev/companion-openclaw-hello-bot',
    )
    expect(json.resources.serviceArn).toContain(
      'service/ender-stack-dev/ender-stack-dev-companion-openclaw-hello-bot',
    )
  })

  it('looks up the shared ALB by name', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(validBody()))
    const firstElbCall = elbv2SendMock.mock.calls[0]?.[0] as {
      __type: string
      input: { Names?: string[] }
    }
    expect(firstElbCall.__type).toBe('DescribeLoadBalancersCommand')
    expect(firstElbCall.input.Names).toEqual(['ender-stack-dev-agents-shared'])
  })

  it('pre-creates the per-agent log group with retention before RegisterTaskDef', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(validBody()))
    const calls = logsSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(calls).toEqual(['CreateLogGroupCommand', 'PutRetentionPolicyCommand'])
    // RegisterTaskDef must be after both log calls. Find the
    // RegisterTaskDef invocation order specifically (DescribeServices
    // for step 0.4 also runs before it; can't index-into [0]).
    const registerIdx = ecsSendMock.mock.calls.findIndex(
      (c) =>
        (c[0] as { __type: string }).__type ===
        'RegisterTaskDefinitionCommand',
    )
    expect(registerIdx).toBeGreaterThanOrEqual(0)
    const registerOrder = ecsSendMock.mock.invocationCallOrder[registerIdx]
    const lastLogOrder =
      logsSendMock.mock.invocationCallOrder[
        logsSendMock.mock.invocationCallOrder.length - 1
      ]
    expect(registerOrder).toBeGreaterThan(lastLogOrder)
  })

  it('treats ResourceAlreadyExistsException on log-group create as idempotent', async () => {
    happyPathMocks()
    // Override CreateLogGroup with a "already exists" error followed by
    // a successful PutRetentionPolicy — handler should swallow and continue.
    logsSendMock.mockReset()
    const alreadyExists = Object.assign(new Error('exists'), {
      name: 'ResourceAlreadyExistsException',
    })
    logsSendMock
      .mockRejectedValueOnce(alreadyExists)
      .mockResolvedValueOnce({})
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
  })

  it('#357 Phase-2: forwards optional persona fields from request body to RegisterTaskDefinition env', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        ...validBody(),
        displayName: 'Aria',
        emoji: '🦊',
        persona: 'Direct, opinionated. Skip filler.',
      }),
    )
    expect(resp.status).toBe(201)
    // Find the RegisterTaskDefinition call and inspect the
    // init-config container's env. Phase-2 emits the persona fields
    // on commonEnv so both containers see them.
    const registerCall = ecsSendMock.mock.calls.find(
      (c) =>
        (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    expect(registerCall).toBeDefined()
    const taskDef = (registerCall![0] as {
      input: {
        containerDefinitions: Array<{
          name: string
          environment?: Array<{ name: string; value: string }>
        }>
      }
    }).input
    const init = taskDef.containerDefinitions.find((c) => c.name === 'init-config')
    expect(init?.environment).toContainEqual({ name: 'AGENT_DISPLAY_NAME', value: 'Aria' })
    expect(init?.environment).toContainEqual({ name: 'AGENT_EMOJI', value: '🦊' })
    expect(init?.environment).toContainEqual({
      name: 'AGENT_PERSONA',
      value: 'Direct, opinionated. Skip filler.',
    })
  })

  it('#357 Phase-2: omits persona fields from RegisterTaskDefinition env when request body omits them (legacy clients)', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody())) // no persona fields
    expect(resp.status).toBe(201)
    const registerCall = ecsSendMock.mock.calls.find(
      (c) =>
        (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    const taskDef = (registerCall![0] as {
      input: {
        containerDefinitions: Array<{
          name: string
          environment?: Array<{ name: string; value: string }>
        }>
      }
    }).input
    const init = taskDef.containerDefinitions.find((c) => c.name === 'init-config')
    expect(
      init?.environment?.find((e) => e.name === 'AGENT_DISPLAY_NAME'),
    ).toBeUndefined()
    expect(
      init?.environment?.find((e) => e.name === 'AGENT_EMOJI'),
    ).toBeUndefined()
    expect(
      init?.environment?.find((e) => e.name === 'AGENT_PERSONA'),
    ).toBeUndefined()
  })

  it('#357 Phase-2: rejects request body with non-string optional field (type guard)', async () => {
    const POST = await importHandler()
    // displayName: 42 should fail the isOptString check in the type guard.
    const resp = await POST(
      mkRequest({ ...validBody(), displayName: 42 }),
    )
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as { error: string }).error).toBe(
      'InvalidRequestShape',
    )
  })

  it('returns an empty warnings array on 201', async () => {
    // The `warnings` field shape is preserved on 201 responses so
    // the response contract is stable for future warnings, but the
    // array is empty for current successful creates — no stale
    // gateway-config-gap warning.
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
    const json = (await resp.json()) as {
      warnings: Array<{ code: string; message: string }>
    }
    expect(Array.isArray(json.warnings)).toBe(true)
    expect(json.warnings).toEqual([])
    // Defense-in-depth: catch a future code path that re-emits the
    // stale warning.
    const codes = json.warnings.map((w) => w.code)
    expect(codes).not.toContain('runtime-config-gap')
  })

  it('CreateRule routes /agent/{name} and /agent/{name}/* to the new TG', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(validBody()))
    const ruleCall = elbv2SendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'CreateRuleCommand',
    )
    expect(ruleCall).toBeDefined()
    const input = (ruleCall![0] as { input: Record<string, unknown> }).input
    // Two explicit patterns prevent prefix-pair collisions (e.g.,
    // `bot` + `bot-test`).
    expect((input.Conditions as Array<Record<string, unknown>>)[0].Values).toEqual(
      ['/agent/hello-bot', '/agent/hello-bot/*'],
    )
    const actions = input.Actions as Array<Record<string, unknown>>
    expect(actions[0].TargetGroupArn).toContain(
      'targetgroup/ender-stack-dev-agent-hello-bot',
    )
  })
})

describe('POST /api/fleet/agents — error handling', () => {
  it('returns 502 with the SDK error name when the shared ALB is missing', async () => {
    litellmStep05Mocks()
    elbv2SendMock.mockResolvedValueOnce({ LoadBalancers: [] })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('Error') // generic Error.name
  })

  it('returns 409 when the ECS service already exists (downstream race past step 0.4)', async () => {
    // This test simulates the TOCTOU window: step 0.4 sees no
    // ACTIVE service, but a concurrent create wins the
    // CreateService race. The step 0.4 DescribeServices returns
    // empty (pre-flight passes); CreateService later 409s.
    happyPathMocks()
    // Override the LAST ecs call (CreateService) with a conflict.
    ecsSendMock.mockReset()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // step 0.4 pre-flight
      .mockResolvedValueOnce({
        taskDefinition: {
          taskDefinitionArn: 'arn:tdf',
        },
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('Service already exists'), {
          name: 'InvalidParameterException',
        }),
      )
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(409)
    const json = (await resp.json()) as {
      error: string
      partialResources?: { litellmKeyAlias?: string; litellmSecretArn?: string }
    }
    expect(json.error).toBe('InvalidParameterException')
    // Round-13 audit (Gap 2): step 0.4 passed but the downstream
    // CreateService race lost, so step 0.5 DID mint a LiteLLM key
    // and write the SM secret. The operator must see them in
    // partialResources to clean up the orphaned LiteLLM key.
    expect(json.partialResources?.litellmKeyAlias).toBe(
      'ender-stack-dev-hello-bot',
    )
    expect(json.partialResources?.litellmSecretArn).toContain(
      'companion-openclaw-hello-bot-litellm-key',
    )
  })

  it('returns 502 (not 409) when InvalidParameterException is a parameter-validation failure, not a conflict', async () => {
    happyPathMocks()
    ecsSendMock.mockReset()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // step 0.4 pre-flight
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf' },
      })
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'Subnet is not a valid Fargate-compatible subnet ID',
          ),
          { name: 'InvalidParameterException' },
        ),
      )
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    // Pre-fix: this would 409 because InvalidParameterException name was
    // hard-mapped to 409. Post-fix: only "already exists"/"in use"
    // messages map to 409; everything else is 502.
    expect(resp.status).toBe(502)
    expect(((await resp.json()) as { error: string }).error).toBe(
      'InvalidParameterException',
    )
  })

  it('surfaces partialResources.serviceArn when CreateService SDK response is missing serviceArn (round-4 audit defensive case)', async () => {
    happyPathMocks()
    // Override the LAST ecs call (CreateService): respond as if AWS
    // succeeded (HTTP 200) but the SDK contract was violated — the
    // service field is present but serviceArn is undefined. The
    // service WAS created on AWS; without serviceArn surfacing in
    // partialResources, the operator has no pointer to clean up the
    // orphaned ECS service.
    ecsSendMock.mockReset()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // step 0.4 pre-flight
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf' },
      })
      .mockResolvedValueOnce({
        // SDK contract violation: serviceArn missing from response
        service: {},
      })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      partialResources?: {
        taskDefinitionArn?: string
        serviceArn?: string
      }
    }
    // The handler throws a generic Error after detecting the missing
    // ARN; outer catch surfaces the Error.name. Important: the
    // partial.serviceArn key is set even when its value is undefined,
    // so the operator gets a structured "this MAY be orphaned" signal.
    expect(json.partialResources).toBeDefined()
    expect(json.partialResources?.taskDefinitionArn).toBe('arn:tdf')
    // null (not undefined) so the field survives JSON.stringify and
    // the operator gets a clear "we don't have it but we tried"
    // signal in the response body.
    expect(json.partialResources?.serviceArn).toBeNull()
  })

  it('returns 409 on DuplicateTargetGroupNameException', async () => {
    // CreateTargetGroup is called before DescribeRules (the priority
    // allocator), so this error path doesn't reach DescribeRules.
    litellmStep05Mocks()
    elbv2SendMock
      .mockResolvedValueOnce({
        LoadBalancers: [{ LoadBalancerArn: 'arn:lb' }],
      })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: 'arn:lst', Protocol: 'HTTP' }],
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('exists'), {
          name: 'DuplicateTargetGroupNameException',
        }),
      )
    logsSendMock.mockResolvedValue({})
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: 'arn:tdf' },
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(409)
  })

  it('surfaces partialResources on partial-failure 5xx so operators can clean up orphans', async () => {
    happyPathMocks()
    // Override the LAST ecs call (CreateService) with a non-conflict
    // failure — earlier creates succeeded so partialResources should
    // surface taskDefinitionArn + targetGroupArn + listenerRuleArn +
    // logGroup.
    ecsSendMock.mockReset()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // step 0.4 pre-flight
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf-1' },
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('aws explosion'), { name: 'ServerException' }),
      )
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      partialResources?: {
        taskDefinitionArn?: string
        targetGroupArn?: string
        listenerRuleArn?: string
        logGroup?: string
      }
    }
    expect(json.error).toBe('ServerException')
    expect(json.partialResources).toBeDefined()
    expect(json.partialResources?.taskDefinitionArn).toBe('arn:tdf-1')
    expect(json.partialResources?.targetGroupArn).toContain(
      'targetgroup/ender-stack-dev-agent-hello-bot',
    )
    expect(json.partialResources?.listenerRuleArn).toContain(
      'listener-rule/app/ender-stack-dev-agents-shared',
    )
    expect(json.partialResources?.logGroup).toBe(
      '/ecs/ender-stack-dev/companion-openclaw-hello-bot',
    )
  })
})

describe('POST /api/fleet/agents — audit trail', () => {
  it('writes a fleet.agent_created security event on successful create', async () => {
    happyPathMocks()
    const securityEvents = await import('@/lib/security-events')
    const POST = await importHandler()
    await POST(mkRequest(validBody()))
    expect(vi.mocked(securityEvents.logSecurityEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'fleet.agent_created',
        agent_name: 'hello-bot',
        source: 'fleet',
      }),
    )
  })
})

describe('POST /api/fleet/agents — listener selection', () => {
  it('picks the HTTP listener when an HTTPS one is also present', async () => {
    elbv2SendMock.mockReset()
    ecsSendMock.mockReset()
    logsSendMock.mockReset()
    smSendMock.mockReset()
    fetchMock.mockReset()
    litellmStep05Mocks()

    elbv2SendMock
      .mockResolvedValueOnce({
        LoadBalancers: [{ LoadBalancerArn: 'arn:lb' }],
      })
      .mockResolvedValueOnce({
        Listeners: [
          // Order intentionally reversed — handler must filter by
          // protocol, not pick by index.
          {
            ListenerArn: 'arn:lst-https',
            Protocol: 'HTTPS',
          },
          {
            ListenerArn: 'arn:lst-http',
            Protocol: 'HTTP',
          },
        ],
      })
      .mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupArn: 'arn:tg' }],
      })
      .mockResolvedValueOnce({
        // DescribeRules — empty for priority allocation
        Rules: [{ Priority: 'default' }],
      })
      .mockResolvedValueOnce({
        Rules: [{ RuleArn: 'arn:rule' }],
      })

    logsSendMock.mockResolvedValue({})
    ecsSendMock
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf' },
      })
      .mockResolvedValueOnce({
        service: { serviceArn: 'arn:svc' },
      })

    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)

    const ruleCall = elbv2SendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'CreateRuleCommand',
    )
    const input = (ruleCall![0] as { input: { ListenerArn: string } }).input
    expect(input.ListenerArn).toBe('arn:lst-http')
  })

  it('502s with a clear error when the LB has only an HTTPS listener', async () => {
    litellmStep05Mocks()
    elbv2SendMock.mockReset()
    elbv2SendMock
      .mockResolvedValueOnce({
        LoadBalancers: [{ LoadBalancerArn: 'arn:lb' }],
      })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: 'arn:lst-https', Protocol: 'HTTPS' }],
      })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
  })
})

describe('POST /api/fleet/agents — env edge cases', () => {
  it('falls back to retention=365 when MC_AGENT_LOG_RETENTION_DAYS is non-numeric', async () => {
    process.env.MC_AGENT_LOG_RETENTION_DAYS = 'totally-bogus'
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
    const retentionCall = logsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'PutRetentionPolicyCommand',
    )
    const input = (
      retentionCall![0] as { input: { retentionInDays: number } }
    ).input
    expect(input.retentionInDays).toBe(365)
  })

  it('returns 500 ConfigurationError when MC_LITELLM_MASTER_KEY_SECRET_ARN is unset (#354)', async () => {
    delete process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ConfigurationError')
    expect(json.detail).toContain('MC_LITELLM_MASTER_KEY_SECRET_ARN')
  })

  it('returns 500 ConfigurationError when MC_AGENT_SECRETS_NAME_PREFIX is unset (#354)', async () => {
    delete process.env.MC_AGENT_SECRETS_NAME_PREFIX
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ConfigurationError')
    expect(json.detail).toContain('MC_AGENT_SECRETS_NAME_PREFIX')
  })
})

describe('POST /api/fleet/agents — per-agent LiteLLM virtual key (#354)', () => {
  it('mints a per-agent virtual key, stores it in SM, and wires the per-agent ARN into the task-def secrets[]', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)

    // /key/generate was called once with the right body shape.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://internal-litellm.us-east-1.elb.amazonaws.com/key/generate',
    )
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-master-NEVER-LOG')
    const body = JSON.parse(init.body as string)
    expect(body.key_alias).toBe('ender-stack-dev-hello-bot')
    expect(body.models).toEqual([
      // Smart router (primary)
      'openai/smart-router', 'smart-router',
      // Anthropic
      'anthropic/claude-opus-4-6',   'claude-opus-4-6',
      'anthropic/claude-opus-4-7',   'claude-opus-4-7',
      'anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',  'claude-haiku-4-5',
      // OpenAI
      'openai/gpt-5.5',      'gpt-5.5',
      'openai/gpt-5.4',      'gpt-5.4',
      'openai/gpt-5.4-mini', 'gpt-5.4-mini',
      'openai/gpt-5.4-nano', 'gpt-5.4-nano',
      'openai/o3',           'o3',
      // Google
      'google/gemini-3.1-pro-preview', 'gemini-3.1-pro-preview',
      'google/gemini-3-flash',         'gemini-3-flash',
      // xAI
      'xai/grok-4-1-fast-reasoning', 'grok-4-1-fast-reasoning',
      // Perplexity
      'perplexity/sonar',     'sonar',
      'perplexity/sonar-pro', 'sonar-pro',
    ])
    expect(body.max_budget).toBe(50)

    // SecretsManager: 1) GetSecretValue (master), 2) PutSecretValue
    // (Put-first idempotent path → not-found), 3) CreateSecret.
    const smCalls = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(smCalls[0]).toBe('GetSecretValueCommand')
    expect(smCalls[1]).toBe('PutSecretValueCommand')
    expect(smCalls[2]).toBe('CreateSecretCommand')
    const createInput = (smSendMock.mock.calls[2][0] as {
      input: { Name: string; Tags: Array<{ Key: string; Value: string }> }
    }).input
    expect(createInput.Name).toBe(
      'ender-stack/dev/companion-openclaw-hello-bot-litellm-key',
    )
    const tagMap = Object.fromEntries(
      createInput.Tags.map((t) => [t.Key, t.Value]),
    )
    expect(tagMap.Project).toBe('ender-stack')
    expect(tagMap.AgentName).toBe('hello-bot')
    expect(tagMap.SecretType).toBe('litellm-key')

    // The RegisterTaskDefinition call carries the per-agent secret
    // ARN in its secrets[] entry, NOT the master-key ARN.
    const registerCall = ecsSendMock.mock.calls.find(
      (c) =>
        (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    expect(registerCall).toBeDefined()
    const containerDefs = (
      registerCall![0] as {
        input: { containerDefinitions: Array<Record<string, unknown>> }
      }
    ).input.containerDefinitions
    for (const c of containerDefs) {
      const secrets = (c.secrets ?? []) as Array<{
        name: string
        valueFrom: string
      }>
      const virtualKey = secrets.find((s) => s.name === 'LITELLM_VIRTUAL_KEY')
      expect(virtualKey).toBeDefined()
      expect(virtualKey!.valueFrom).toContain(
        'companion-openclaw-hello-bot-litellm-key',
      )
      // Master-key ARN must NOT leak into the task-def.
      expect(virtualKey!.valueFrom).not.toContain('litellm-master-key')
    }
  })

  it('aborts the create with 502 if /key/generate fails — no AWS resources are touched', async () => {
    // Step 0.4 DescribeServices (empty), then master-key read OK,
    // then /key/generate 503s.
    primeStep04NoConflict()
    smSendMock.mockResolvedValueOnce({
      SecretString: 'sk-master-NEVER-LOG',
    })
    fetchMock.mockResolvedValueOnce(
      ({
        ok: false,
        status: 503,
        text: async () => 'upstream busy',
        json: async () => ({}),
      }) as unknown as Response,
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      partialResources?: Record<string, unknown>
    }
    expect(json.error).toBe('LiteLLMManagementError')
    // No partial AWS resources — we failed before any provisioning AWS call.
    expect(json.partialResources?.taskDefinitionArn).toBeUndefined()
    expect(json.partialResources?.targetGroupArn).toBeUndefined()
    expect(json.partialResources?.listenerRuleArn).toBeUndefined()
    expect(json.partialResources?.logGroup).toBeUndefined()
    expect(elbv2SendMock).not.toHaveBeenCalled()
    expect(logsSendMock).not.toHaveBeenCalled()
    // ECS WAS called once (DescribeServices for step 0.4 pre-flight)
    // but NOT for any provisioning verbs.
    const ecsCommandTypes = ecsSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(ecsCommandTypes).toEqual(['DescribeServicesCommand'])
  })

  it('aborts the create with 502 LiteLLMMasterKeyMalformed when SM returns no SecretString (round-13 audit Gap 1)', async () => {
    // Realistic misconfiguration: the master-key secret was
    // accidentally stored as binary, or the SecretString is
    // empty. getLiteLLMMasterKey throws LiteLLMMasterKeyMalformed,
    // which the outer catch surfaces as 502 with the named error
    // so operators can find it in their runbook.
    primeStep04NoConflict()
    smSendMock.mockResolvedValueOnce({
      // No SecretString — simulates binary-only secret or write
      // anomaly.
      ARN: 'arn:aws:secretsmanager:test:1',
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('LiteLLMMasterKeyMalformed')
    // /key/generate was never reached.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts the create with 502 if master-key Secrets Manager read fails', async () => {
    primeStep04NoConflict()
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('LiteLLMMasterKeyNotFound')
    // /key/generate was never called.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(elbv2SendMock).not.toHaveBeenCalled()
  })

  it('returns 409 ServiceAlreadyExists BEFORE touching LiteLLM when an ACTIVE service exists (#354 round-12)', async () => {
    // The critical correctness fix: a second create-agent call
    // with the same agent name must NOT revoke the running
    // agent's LiteLLM key via the rotation path. Step 0.4
    // DescribeServices catches the conflict first and returns
    // 409 with no LiteLLM side effects.
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn:
            'arn:aws:ecs:us-east-1:398152419239:service/ender-stack-dev/ender-stack-dev-companion-openclaw-hello-bot',
          status: 'ACTIVE',
        },
      ],
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(409)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ServiceAlreadyExists')
    expect(json.detail).toContain('hello-bot')
    // CRITICAL: NO LiteLLM /key/delete or /key/generate was called.
    expect(fetchMock).not.toHaveBeenCalled()
    // NO master-key SM read either.
    expect(smSendMock).not.toHaveBeenCalled()
    // No downstream AWS provisioning verbs.
    const ecsCommandTypes = ecsSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(ecsCommandTypes).toEqual(['DescribeServicesCommand'])
    expect(elbv2SendMock).not.toHaveBeenCalled()
    expect(logsSendMock).not.toHaveBeenCalled()
  })

  it('proceeds past step 0.4 when the existing service is INACTIVE (prior failed delete tombstone)', async () => {
    // INACTIVE services indicate a prior delete partially failed
    // and ECS tombstoned the service. The create should still
    // proceed — let the new attempt fill in any gaps.
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: 'arn:aws:ecs:us-east-1:398152419239:service/x/y',
          status: 'INACTIVE',
        },
      ],
    })
    // Continue with happy-path beyond step 0.4.
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      )
      .mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:test-litellm-key',
      })
    fetchMock.mockResolvedValueOnce(mkLiteLLMKeyResponse())
    elbv2SendMock
      .mockResolvedValueOnce({
        LoadBalancers: [{ LoadBalancerArn: 'arn:lb' }],
      })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: 'arn:lst', Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: 'arn:tg' }] })
      .mockResolvedValueOnce({ Rules: [{ Priority: 'default' }] })
      .mockResolvedValueOnce({ Rules: [{ RuleArn: 'arn:rule' }] })
    logsSendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({})
    ecsSendMock
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf' },
      })
      .mockResolvedValueOnce({ service: { serviceArn: 'arn:svc' } })

    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
    // /key/generate WAS called — step 0.4 didn't short-circuit.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on retry, recovers a duplicate-alias /key/generate via /key/delete + re-mint (#354 round-2)', async () => {
    // Scenario: prior create-agent partial-failure left a LiteLLM
    // alias dangling but the ECS service was never created. Step
    // 0.4 (round-12 pre-flight) sees no ACTIVE service → proceed.
    // Step 0.5 hits duplicate-alias → rotation revokes + re-mints.
    primeStep04NoConflict()
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      )
      .mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-litellm-key-XyZ',
      })
    fetchMock
      .mockResolvedValueOnce(
        ({
          ok: false,
          status: 400,
          text: async () => '{"detail":"key_alias already exists"}',
          json: async () => ({ detail: 'key_alias already exists' }),
        }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        ({
          ok: true,
          status: 200,
          text: async () => '{"deleted":1}',
          json: async () => ({ deleted: 1 }),
        }) as unknown as Response,
      )
      .mockResolvedValueOnce(mkLiteLLMKeyResponse('sk-rotated-key'))

    // Standard happy-path AWS responses for the rest of the create flow.
    elbv2SendMock
      .mockResolvedValueOnce({
        LoadBalancers: [{ LoadBalancerArn: 'arn:lb' }],
      })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: 'arn:lst', Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        TargetGroups: [
          {
            TargetGroupArn:
              'arn:aws:elasticloadbalancing:us-east-1:398152419239:targetgroup/ender-stack-dev-agent-hello-bot/tg1',
          },
        ],
      })
      .mockResolvedValueOnce({ Rules: [{ Priority: 'default' }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn:
              'arn:aws:elasticloadbalancing:us-east-1:398152419239:listener-rule/app/ender-stack-dev-agents-shared/abc/lst1/r1',
          },
        ],
      })
    logsSendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({})
    ecsSendMock
      .mockResolvedValueOnce({
        taskDefinition: { taskDefinitionArn: 'arn:tdf' },
      })
      .mockResolvedValueOnce({
        service: { serviceArn: 'arn:svc' },
      })

    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(201)
    // Three fetch calls: original /key/generate (400) → /key/delete →
    // retried /key/generate (200).
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const paths = fetchMock.mock.calls.map(
      (c) => (c[0] as string).replace(/^.+amazonaws\.com/, ''),
    )
    expect(paths).toEqual(['/key/generate', '/key/delete', '/key/generate'])
  })

  it('surfaces partialResources.litellmKeyAlias when SM write fails after /key/generate succeeded', async () => {
    primeStep04NoConflict()
    // Master read OK, /key/generate OK, but Put + Create both fail
    // → the key is on LiteLLM but we never wrote the SM secret.
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('quota'), { name: 'LimitExceededException' }),
      )
    fetchMock.mockResolvedValueOnce(mkLiteLLMKeyResponse())
    const POST = await importHandler()
    const resp = await POST(mkRequest(validBody()))
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      partialResources?: { litellmKeyAlias?: string; litellmSecretArn?: string }
    }
    // Operator needs the alias so they can revoke the now-orphaned key.
    expect(json.partialResources?.litellmKeyAlias).toBe(
      'ender-stack-dev-hello-bot',
    )
    // SM write failed → no ARN to surface.
    expect(json.partialResources?.litellmSecretArn).toBeUndefined()
  })
})

/**
 * Drift detection for `DEFAULT_LITELLM_MODEL_ALLOWLIST` (#365).
 *
 * Every model referenced by ender-stack's init-config.sh MUST be in
 * MC's per-agent virtual-key allowlist, in BOTH `provider/name` and
 * bare `name` form — OpenClaw strips the provider prefix before
 * calling LiteLLM, and LiteLLM does exact string match.
 *
 * `INIT_CONFIG_MODEL_CATALOG` is a literal copy of init-config's
 * `modelsAllowlist` (line ~559). If you add a model in either repo
 * without updating the other, this test fails — that's the whole
 * point. To resync: update both this fixture AND the allowlist in
 * agents.ts.
 */
describe('DEFAULT_LITELLM_MODEL_ALLOWLIST drift detection (#365)', () => {
  const INIT_CONFIG_MODEL_CATALOG = [
    'anthropic/claude-opus-4-6',
    'anthropic/claude-opus-4-7',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
    'openai/gpt-5.5',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini',
    'openai/gpt-5.4-nano',
    'openai/o3',
    'openai/smart-router',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3-flash',
    'xai/grok-4-1-fast-reasoning',
    'perplexity/sonar',
    'perplexity/sonar-pro',
  ] as const

  it('contains every init-config model in prefixed and unprefixed form', async () => {
    const { DEFAULT_LITELLM_MODEL_ALLOWLIST } = await import(
      '@/extensions/fleet/api/agents'
    )
    const allowlistSet = new Set(DEFAULT_LITELLM_MODEL_ALLOWLIST)
    const missing: string[] = []
    for (const prefixed of INIT_CONFIG_MODEL_CATALOG) {
      const slash = prefixed.indexOf('/')
      const bare = slash === -1 ? prefixed : prefixed.slice(slash + 1)
      if (!allowlistSet.has(prefixed)) missing.push(prefixed)
      if (!allowlistSet.has(bare)) missing.push(bare)
    }
    expect(missing).toEqual([])
  })

  // Catch the other direction too — stale allowlist entries left
  // behind after init-config drops a model. Without this, a
  // removed model could linger in the allowlist indefinitely (no
  // functional harm, but invites drift). Pair this with the
  // forward direction above so the sets stay byte-equal modulo
  // the prefix/bare split.
  //
  // Known limitation: INIT_CONFIG_MODEL_CATALOG is a manually-
  // maintained literal copy of init-config.sh. If a developer
  // removes a model from init-config AND forgets to update this
  // fixture, both tests still pass. The companion ender-stack PR
  // adds a same-file consistency check on the init-config side
  // (every primary/fallback/subagent model in agents.defaults.models),
  // which closes the cross-side gap at the cost of a manual sync
  // step here. Until init-config and MC share a single catalog
  // (deferred — see ender-stack#367), this fixture must be
  // hand-synced when init-config's modelsAllowlist changes.
  it('does not contain prefixed entries absent from init-config (no stale allowlist entries)', async () => {
    const { DEFAULT_LITELLM_MODEL_ALLOWLIST } = await import(
      '@/extensions/fleet/api/agents'
    )
    const catalogPrefixed = new Set<string>(INIT_CONFIG_MODEL_CATALOG)
    const catalogBare = new Set<string>(
      INIT_CONFIG_MODEL_CATALOG.map((m) => {
        const slash = m.indexOf('/')
        return slash === -1 ? m : m.slice(slash + 1)
      }),
    )
    const stale: string[] = []
    for (const entry of DEFAULT_LITELLM_MODEL_ALLOWLIST) {
      const hasSlash = entry.includes('/')
      if (hasSlash) {
        // Prefixed entries must appear verbatim in init-config.
        if (!catalogPrefixed.has(entry)) stale.push(entry)
      } else {
        // Bare entries must correspond to a prefixed catalog entry.
        if (!catalogBare.has(entry)) stale.push(entry)
      }
    }
    expect(stale).toEqual([])
  })
})
