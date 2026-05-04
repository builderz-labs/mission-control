import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as auth from '@/lib/auth'

const ecsSendMock = vi.fn()
const smSendMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
  DescribeTaskDefinitionCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeTaskDefinitionCommand',
    input,
  })),
  RegisterTaskDefinitionCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'RegisterTaskDefinitionCommand',
    input,
  })),
  UpdateServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'UpdateServiceCommand',
    input,
  })),
}))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: smSendMock })),
  CreateSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateSecretCommand',
    input,
  })),
  PutSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutSecretValueCommand',
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
  const mod = await import('../api/slack-credentials')
  return mod.POST
}

const setRequiredEnv = () => {
  process.env.AWS_REGION = 'us-east-1'
  process.env.MC_FLEET_CLUSTER_NAME = 'ender-stack-dev'
  process.env.MC_FLEET_PROJECT_NAME = 'ender-stack'
  process.env.MC_FLEET_ENVIRONMENT = 'dev'
  process.env.MC_AGENT_SECRETS_NAME_PREFIX = 'ender-stack/dev/companion-openclaw'
}

const AGENT = 'hello-bot'
const SERVICE_ARN = `arn:aws:ecs:us-east-1:398152419239:service/ender-stack-dev/ender-stack-dev-companion-openclaw-${AGENT}`
const CURRENT_TD_ARN = `arn:aws:ecs:us-east-1:398152419239:task-definition/ender-stack-dev-companion-openclaw-${AGENT}:5`
const NEW_TD_ARN = `arn:aws:ecs:us-east-1:398152419239:task-definition/ender-stack-dev-companion-openclaw-${AGENT}:6`

const validBody = () => ({
  appToken: 'xapp-1-A12345678-1234567890-abcdef0123456789',
  botToken: 'xoxb-12345-67890-abcdefABCDEFabcdef-extra',
  signingSecret: 'a'.repeat(32), // Slack signing secrets are exactly 32 lowercase hex chars
  channels: ['C0123456789'],
})

const mkRequest = (body?: unknown) =>
  ({
    json: async () => (body === undefined ? validBody() : body),
    url: `http://localhost/api/fleet/agents/${AGENT}/slack/credentials`,
  }) as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]

const mkParams = (name: string = AGENT) => ({
  params: Promise.resolve({ name }),
})

const mockHarnessService = () =>
  ecsSendMock.mockResolvedValueOnce({
    services: [
      {
        serviceArn: SERVICE_ARN,
        status: 'ACTIVE',
        taskDefinition: CURRENT_TD_ARN,
        tags: [
          { key: 'Component', value: 'agent-harness' },
          { key: 'ManagedBy', value: 'mission-control' },
        ],
      },
    ],
  })

const mockTaskDef = () =>
  ecsSendMock.mockResolvedValueOnce({
    taskDefinition: {
      taskDefinitionArn: CURRENT_TD_ARN,
      family: `ender-stack-dev-companion-openclaw-${AGENT}`,
      revision: 5,
      status: 'ACTIVE',
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '512',
      memory: '1024',
      taskRoleArn: 'arn:role:task',
      executionRoleArn: 'arn:role:exec',
      containerDefinitions: [
        { name: 'init-config', image: 'foo', essential: false },
        {
          name: 'gateway',
          image: 'foo',
          essential: true,
          environment: [{ name: 'OPENCLAW_AGENT_NAME', value: AGENT }],
        },
      ],
      // Read-only fields that should be stripped on register
      registeredAt: new Date(),
      registeredBy: 'arn:user',
    },
  })

const happyPathMocks = () => {
  ecsSendMock.mockReset()
  smSendMock.mockReset()
  mockHarnessService()
  smSendMock.mockResolvedValueOnce({
    ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-slack-app-token-AbCdEf',
  })
  smSendMock.mockResolvedValueOnce({
    ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-slack-bot-token-GhIjKl',
  })
  smSendMock.mockResolvedValueOnce({
    ARN: 'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-slack-signing-secret-MnOpQr',
  })
  mockTaskDef()
  ecsSendMock.mockResolvedValueOnce({
    taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
  })
  ecsSendMock.mockResolvedValueOnce({
    service: {
      serviceArn: SERVICE_ARN,
      deployments: [{ id: 'ecs-svc/12345', status: 'PRIMARY' }],
    },
  })
}

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
  smSendMock.mockReset()
})

describe('POST /api/fleet/agents/:name/slack/credentials — happy path', () => {
  it('returns 200 with task-def ARN + deploymentId + secret ARNs', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      ok: boolean
      agentName: string
      taskDefinitionArn: string
      deploymentId?: string
      secretArns: { appToken: string; botToken: string; signingSecret: string }
    }
    expect(json.ok).toBe(true)
    expect(json.agentName).toBe(AGENT)
    expect(json.taskDefinitionArn).toBe(NEW_TD_ARN)
    expect(json.deploymentId).toBe('ecs-svc/12345')
    expect(json.secretArns.appToken).toContain('slack-app-token')
    expect(json.secretArns.botToken).toContain('slack-bot-token')
    expect(json.secretArns.signingSecret).toContain('slack-signing-secret')
  })

  it('writes 3 secrets to Secrets Manager (PutSecretValue happy path)', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const putCalls = smSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'PutSecretValueCommand',
    )
    expect(putCalls).toHaveLength(3)
  })

  it('falls back to CreateSecret when PutSecretValue throws ResourceNotFoundException', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
    })
    // writeSlackSecrets uses Promise.all so all 3 PutSecretValue
    // calls fire BEFORE any of them awaits — the mock chain is
    // call-order, not per-secret-sequential. So: 3 Puts reject
    // first, then 3 Creates resolve.
    smSendMock
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-1' })
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-2' })
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-3' })
    mockTaskDef()
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
    })
    ecsSendMock.mockResolvedValueOnce({
      service: {
        serviceArn: SERVICE_ARN,
        deployments: [{ id: 'ecs-svc/12345', status: 'PRIMARY' }],
      },
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    // 3 PutSecretValue + 3 CreateSecret = 6 SM calls total
    expect(smSendMock).toHaveBeenCalledTimes(6)
  })

  it('gateway gets the 3 secrets but NOT OPENCLAW_SLACK_CONFIG_JSON (ender-stack#286)', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    expect(registerCall).toBeDefined()
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    const containers = input.containerDefinitions as Array<{
      name: string
      secrets?: Array<{ name: string; valueFrom: string }>
      environment?: Array<{ name: string; value: string }>
    }>
    const gateway = containers.find((c) => c.name === 'gateway')
    expect(gateway).toBeDefined()
    expect(gateway!.secrets).toHaveLength(3)
    expect(gateway!.secrets!.map((s) => s.name)).toEqual([
      'SLACK_APP_TOKEN',
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET',
    ])
    // ender-stack#286: OPENCLAW_SLACK_CONFIG_JSON must NOT
    // appear on the gateway container — it belongs on init.
    const gatewayEnvNames = (gateway!.environment ?? []).map((e) => e.name)
    expect(gatewayEnvNames).not.toContain('OPENCLAW_SLACK_CONFIG_JSON')
  })

  it('init-config gets OPENCLAW_SLACK_CONFIG_JSON but NOT secrets (ender-stack#286)', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    expect(registerCall).toBeDefined()
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    const containers = input.containerDefinitions as Array<{
      name: string
      secrets?: Array<{ name: string; valueFrom: string }>
      environment?: Array<{ name: string; value: string }>
    }>
    const initConfig = containers.find((c) => c.name === 'init-config')
    expect(initConfig).toBeDefined()
    const slackConfigEnv = initConfig!.environment!.find(
      (e) => e.name === 'OPENCLAW_SLACK_CONFIG_JSON',
    )
    expect(slackConfigEnv).toBeDefined()
    expect(slackConfigEnv!.value).toContain('C0123456789')
    // Secrets stay on gateway only — init container shouldn't
    // get them (no plugin-runtime in init reads them).
    const initSecrets = initConfig!.secrets ?? []
    expect(initSecrets.map((s) => s.name)).not.toContain('SLACK_APP_TOKEN')
    expect(initSecrets.map((s) => s.name)).not.toContain('SLACK_BOT_TOKEN')
    expect(initSecrets.map((s) => s.name)).not.toContain('SLACK_SIGNING_SECRET')
  })

  it('strips read-only task-def fields before RegisterTaskDefinition', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    expect(input.taskDefinitionArn).toBeUndefined()
    expect(input.revision).toBeUndefined()
    expect(input.status).toBeUndefined()
    expect(input.registeredAt).toBeUndefined()
    expect(input.registeredBy).toBeUndefined()
  })

  it('forces a new deployment via UpdateService', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const updateCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'UpdateServiceCommand',
    )
    expect(updateCall).toBeDefined()
    const input = (updateCall![0] as { input: Record<string, unknown> }).input
    expect(input.forceNewDeployment).toBe(true)
    expect(input.taskDefinition).toBe(NEW_TD_ARN)
  })

  it('does not duplicate OPENCLAW_SLACK_CONFIG_JSON when re-pasting (env replacement on init-config — ender-stack#286)', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    // ender-stack#286: dedup check now lives on the init-config
    // container's env block (not the gateway). Task-def has the
    // env on init from a prior paste — re-paste should replace,
    // not duplicate.
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: CURRENT_TD_ARN,
        family: 'fam',
        containerDefinitions: [
          {
            name: 'init-config',
            image: 'foo',
            essential: false,
            environment: [
              { name: 'OPENCLAW_AGENT_NAME', value: AGENT },
              { name: 'OPENCLAW_SLACK_CONFIG_JSON', value: '{"channels":["C_OLD"]}' },
            ],
          },
          {
            name: 'gateway',
            image: 'foo',
            essential: true,
            environment: [{ name: 'OPENCLAW_AGENT_NAME', value: AGENT }],
          },
        ],
      },
    })
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
    })
    ecsSendMock.mockResolvedValueOnce({ service: { deployments: [] } })
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    const containers = input.containerDefinitions as Array<{
      name: string
      environment?: Array<{ name: string; value: string }>
    }>
    const initConfig = containers.find((c) => c.name === 'init-config')!
    const slackEnvCount = initConfig.environment!.filter(
      (e) => e.name === 'OPENCLAW_SLACK_CONFIG_JSON',
    ).length
    expect(slackEnvCount).toBe(1)
    // And the new value, not the stale one
    const slackEnv = initConfig.environment!.find(
      (e) => e.name === 'OPENCLAW_SLACK_CONFIG_JSON',
    )
    expect(slackEnv!.value).toContain('C0123456789')
    expect(slackEnv!.value).not.toContain('C_OLD')
  })
})

describe('POST /api/fleet/agents/:name/slack/credentials — token validation', () => {
  it('returns 400 InvalidTokenShape with field errors when appToken is wrong shape', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), appToken: 'not-an-xapp-token' }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as {
      error: string
      fieldErrors?: Record<string, string>
    }
    expect(json.error).toBe('InvalidTokenShape')
    expect(json.fieldErrors?.appToken).toBeDefined()
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 with botToken field error when bot token has wrong prefix', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), botToken: 'xapp-wrong-prefix' }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as {
      fieldErrors?: Record<string, string>
    }
    expect(json.fieldErrors?.botToken).toBeDefined()
  })

  it('returns 400 with signingSecret field error when not exactly 32 lowercase hex chars', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), signingSecret: 'too-short' }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as {
      fieldErrors?: Record<string, string>
    }
    expect(json.fieldErrors?.signingSecret).toBeDefined()
  })

  it('accepts exactly 32-char hex signing secret (Slack spec)', async () => {
    happyPathMocks()
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), signingSecret: 'a'.repeat(32) }),
      mkParams(),
    )
    expect(resp.status).toBe(200)
  })
})

describe('POST /api/fleet/agents/:name/slack/credentials — refusal paths', () => {
  it('returns 404 when service does not exist', async () => {
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 404 for non-MC-managed service (smoke-test protection)', async () => {
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          taskDefinition: CURRENT_TD_ARN,
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'terraform' },
          ],
        },
      ],
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 403 when caller is not admin', async () => {
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Forbidden',
      status: 403,
    } as unknown as ReturnType<typeof auth.requireRole>)
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(403)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 InvalidAgentName when path param fails AGENT_NAME_RE', async () => {
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams('UPPERCASE'))
    expect(resp.status).toBe(400)
  })

  it('returns 400 InvalidRequestShape when body lacks required fields', async () => {
    const POST = await importHandler()
    const resp = await POST(mkRequest({ appToken: 'foo' }), mkParams())
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('InvalidRequestShape')
  })

  it('returns 500 ConfigurationError when MC_AGENT_SECRETS_NAME_PREFIX is unset', async () => {
    delete process.env.MC_AGENT_SECRETS_NAME_PREFIX
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ConfigurationError')
    expect(ecsSendMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/fleet/agents/:name/slack/credentials — round-1 audit hardening', () => {
  it('returns 400 InvalidChannelList when channels exceed cap', async () => {
    const POST = await importHandler()
    // Channel IDs must match CHANNEL_ID_RE — generate valid-shape IDs
    // to ensure the count cap (not the per-item check) is what fires.
    const oversized = Array.from(
      { length: 51 },
      (_, i) => `C${String(i).padStart(9, 'A')}`,
    )
    const resp = await POST(
      mkRequest({ ...validBody(), channels: oversized }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('InvalidChannelList')
    expect(json.detail).toContain('51')
    // No AWS calls — bail fast
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 InvalidChannelList when a single channel ID has wrong format', async () => {
    // Slack channel IDs are [CGD] + 8-12 alphanumerics. Round-2
    // audit added per-item validation so a single huge string can't
    // bypass the count cap and inflate OPENCLAW_SLACK_CONFIG_JSON
    // past the ECS env-value 512-char limit.
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({
        ...validBody(),
        channels: ['C0123456789', 'this-is-not-a-channel-id-at-all'],
      }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('InvalidChannelList')
    expect(json.detail).toContain('Slack format')
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 404 when service is DRAINING (not just INACTIVE)', async () => {
    // Round-2 audit on PR #48: tightened from "INACTIVE only" to
    // "anything other than ACTIVE" — DRAINING shouldn't accept
    // new credential pastes.
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'DRAINING',
          taskDefinition: CURRENT_TD_ARN,
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'mission-control' },
          ],
        },
      ],
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('uses include=[TAGS] on DescribeTaskDefinition', async () => {
    happyPathMocks()
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const describeTdCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'DescribeTaskDefinitionCommand',
    )
    expect(describeTdCall).toBeDefined()
    const input = (describeTdCall![0] as { input: Record<string, unknown> }).input
    expect(input.include).toEqual(['TAGS'])
  })

  it('preserves tags from existing task-def when registering new revision', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    // Task-def response includes tags at the top level (response shape)
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: CURRENT_TD_ARN,
        family: `ender-stack-dev-companion-openclaw-${AGENT}`,
        containerDefinitions: [
          { name: 'init-config', image: 'foo', essential: false, environment: [] },
          { name: 'gateway', image: 'foo', essential: true, environment: [] },
        ],
      },
      tags: [
        { key: 'Project', value: 'ender-stack' },
        { key: 'Environment', value: 'dev' },
        { key: 'AgentName', value: AGENT },
      ],
    })
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
    })
    ecsSendMock.mockResolvedValueOnce({
      service: { deployments: [{ id: 'd1', status: 'PRIMARY' }] },
    })
    const POST = await importHandler()
    await POST(mkRequest(), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    expect(input.tags).toEqual([
      { key: 'Project', value: 'ender-stack' },
      { key: 'Environment', value: 'dev' },
      { key: 'AgentName', value: AGENT },
    ])
  })

  it('throws TaskDefinitionGatewayMissing when no gateway container exists in task-def', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    // Task-def with no gateway container — silent no-op pre-fix
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: CURRENT_TD_ARN,
        family: 'fam',
        containerDefinitions: [
          { name: 'init-config', image: 'foo', essential: false },
          { name: 'NOT-gateway', image: 'foo', essential: true },
        ],
      },
      tags: [],
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('TaskDefinitionGatewayMissing')
    // Round-7 audit on PR #48: non-retriable detail must NOT
    // suggest "retry is safe" — that hint would loop an operator
    // on a config-mismatch failure. Detail must mention the
    // remediation file (templates/openclaw.ts) so a runbook reader
    // knows where to look.
    expect(json.detail).toContain('Non-retriable')
    expect(json.detail).toContain('templates/openclaw.ts')
    expect(json.detail).not.toContain('retry is safe')
    // Round-2 audit on PR #52: GatewayMissing detail aligned
    // with InitMissing wording — both throw before
    // RegisterTaskDefinition, both leave the task-def
    // unchanged. Wording must be consistent.
    expect(json.detail).toContain('task-def was NOT updated')
    expect(json.detail).toContain('will not resolve')
  })

  it('throws TaskDefinitionInitMissing when no init-config container exists (ender-stack#286)', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    // Task-def with gateway but no init-config — pre-#286 the
    // channel env would have silently landed on gateway with
    // no consumer. Now: throws TaskDefinitionInitMissing
    // before RegisterTaskDefinition.
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: {
        taskDefinitionArn: CURRENT_TD_ARN,
        family: 'fam',
        containerDefinitions: [
          { name: 'gateway', image: 'foo', essential: true },
          { name: 'NOT-init-config', image: 'foo', essential: false },
        ],
      },
      tags: [],
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('TaskDefinitionInitMissing')
    expect(json.detail).toContain('Non-retriable')
    expect(json.detail).toContain("'init-config' container")
    // Round-1 audit on PR #52: detail must clarify that the
    // task-def was NOT updated — operator could otherwise read
    // "secrets written" + "next paste will overwrite" as
    // "gateway is configured-but-incomplete," when actually
    // the live revision has zero references to the secrets.
    expect(json.detail).toContain('task-def was NOT updated')
    expect(json.detail).toContain('will not resolve')
    expect(json.detail).toContain('templates/openclaw.ts')
  })

  it('surfaces a safe-retry hint on 502 when secrets-write was attempted', async () => {
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    mockTaskDef()
    // RegisterTaskDefinition fails AFTER secrets were written
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('throttle'), {
        name: 'ThrottlingException',
      }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ThrottlingException')
    expect(json.detail).toContain('Secrets-write was attempted')
    expect(json.detail).toContain('retry is safe')
  })

  it('surfaces dangling-task-def hint when UpdateService fails after RegisterTaskDef succeeds', async () => {
    // Round-2 audit on PR #48: when a new task-def is registered
    // but UpdateService fails, the operator should know the prior
    // revision is dangling (cosmetic — re-paste registers another;
    // the dangling one is harmless but tidy operators may want to
    // deregister it).
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    mockTaskDef()
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
    })
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('throttle'), {
        name: 'ThrottlingException',
      }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.detail).toContain(NEW_TD_ARN)
    expect(json.detail).toContain('dangling')
  })

  it('does NOT surface secrets-attempted hint when failure is pre-secrets-write', async () => {
    // DescribeServices returns no service → 404 path, no hint expected
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { detail?: string }
    expect(json.detail ?? '').not.toContain('Secrets-write was attempted')
  })

  it('throws PutSecretValueMissingArn when SDK returns no ARN (round-3 P1 — silent crash-loop guard)', async () => {
    // Pre-fix: an empty ARN propagated through writeSlackSecrets to
    // the task-def's secrets[].valueFrom, causing ECS to crash-loop
    // at task-launch with an opaque error. Round-3 P1 fix throws
    // loudly so the operator sees a clean 502 + safe-retry hint
    // instead of a registered-but-broken task-def.
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ ARN: undefined }) // SDK anomaly
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('PutSecretValueMissingArn')
    // Hint should fire — secrets-write was attempted (even if 1 of
    // the 3 returned a quirky response).
    expect(json.detail).toContain('Secrets-write was attempted')
  })

  it('throws CreateSecretMissingArn when first-time-paste SDK returns no ARN (round-4 — symmetric to PutSecretValueMissingArn)', async () => {
    // Round-3 fixed the PutSecretValue branch; round-4 audit caught
    // that CreateSecret has the same risk on first-time paste:
    // the secret doesn't exist yet → Put rejects with
    // ResourceNotFoundException → we fall through to CreateSecret →
    // SDK anomaly returns no ARN. Pre-fix: empty `valueFrom`
    // propagated into the task-def, ECS crash-loop. Post-fix:
    // throws CreateSecretMissingArn → 502 + safe-retry hint.
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
    })
    smSendMock
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ ARN: undefined }) // SDK anomaly
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-2' })
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-3' })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('CreateSecretMissingArn')
    expect(json.detail).toContain('Secrets-write was attempted')
  })

  it('recovers from CreateSecret race via Put retry when ResourceExistsException is thrown (round-6 — TOCTOU on first-time paste)', async () => {
    // Two concurrent first-time pastes both see Put → RNFE,
    // both fall through to Create. The race winner establishes
    // the secret; the loser hits ResourceExistsException. Pre-
    // round-6: RES propagated up, 502 to the operator. Post-
    // round-6: catch RES, retry as Put (which now succeeds
    // since the secret exists), 200 with last-writer-wins
    // semantics.
    ecsSendMock.mockReset()
    smSendMock.mockReset()
    mockHarnessService()
    const notFound = Object.assign(new Error('not found'), {
      name: 'ResourceNotFoundException',
    })
    const exists = Object.assign(new Error('exists'), {
      name: 'ResourceExistsException',
    })
    // Ordering: 3× Put rejected with RNFE (call ordering is
    // mock-call-order, not per-secret-sequential, since
    // writeSlackSecrets uses Promise.all). Then for the create
    // round: 1 succeeds, 1 hits RES (race-loser), 1 succeeds.
    // Then for the RES retry: 1 Put with the race-loser's value
    // succeeds.
    smSendMock
      .mockRejectedValueOnce(notFound) // Put 1
      .mockRejectedValueOnce(notFound) // Put 2
      .mockRejectedValueOnce(notFound) // Put 3
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-1' }) // Create 1
      .mockRejectedValueOnce(exists) // Create 2 — race loser
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-3' }) // Create 3
      .mockResolvedValueOnce({ ARN: 'arn:secret:created-2-retry' }) // Put retry for race loser
    mockTaskDef()
    ecsSendMock.mockResolvedValueOnce({
      taskDefinition: { taskDefinitionArn: NEW_TD_ARN, revision: 6 },
    })
    ecsSendMock.mockResolvedValueOnce({
      service: {
        serviceArn: SERVICE_ARN,
        deployments: [{ id: 'ecs-svc/12345', status: 'PRIMARY' }],
      },
    })
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    // 3 Put + 3 Create + 1 retry-Put = 7 SM calls
    expect(smSendMock).toHaveBeenCalledTimes(7)
  })

  it('returns 400 when serialized channels JSON exceeds 512-char ECS env limit (round-3 P2)', async () => {
    // Worst case: 50 channels × ~15 chars + framing = ~814 chars,
    // which exceeds the ECS env-value cap. The count + format
    // checks bound the input shape but don't guarantee the
    // serialized form fits. Final length check before
    // RegisterTaskDefinition catches it cleanly.
    const POST = await importHandler()
    // 40 valid 13-char channel IDs would serialize to >512 chars.
    const channels = Array.from(
      { length: 40 },
      (_, i) =>
        `C${String(i).padStart(12, 'A').slice(0, 12).toUpperCase()}`,
    )
    const resp = await POST(
      mkRequest({ ...validBody(), channels }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('InvalidChannelList')
    expect(json.detail).toContain('512-char')
  })

  it('deduplicates duplicate channel IDs before serializing OPENCLAW_SLACK_CONFIG_JSON (round-8 audit)', async () => {
    // Pre-fix, ['C0123456789', 'C0123456789'] passed all three
    // validation layers (count cap, per-item regex, 512-char
    // serialized) and produced
    // OPENCLAW_SLACK_CONFIG_JSON='{"channels":["C0123456789","C0123456789"]}',
    // which the OpenClaw Slack plugin (Beat 5d) would subscribe
    // to twice → duplicate event delivery. Dedupe via Set
    // collapses identical IDs before stringify.
    happyPathMocks()
    const POST = await importHandler()
    const channels = ['C0123456789', 'C9876543210', 'C0123456789']
    await POST(mkRequest({ ...validBody(), channels }), mkParams())
    const registerCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'RegisterTaskDefinitionCommand',
    )
    expect(registerCall).toBeDefined()
    const input = (registerCall![0] as { input: Record<string, unknown> }).input
    const containers = input.containerDefinitions as Array<{
      name: string
      environment?: Array<{ name: string; value: string }>
    }>
    // ender-stack#286: env now lives on init-config, not gateway.
    const initConfig = containers.find((c) => c.name === 'init-config')
    const slackConfigEnv = initConfig!.environment!.find(
      (e) => e.name === 'OPENCLAW_SLACK_CONFIG_JSON',
    )
    expect(slackConfigEnv).toBeDefined()
    const parsed = JSON.parse(slackConfigEnv!.value) as { channels: string[] }
    // Set preserves first-occurrence order: dedupe of
    // [a, b, a] → [a, b], not [b, a].
    expect(parsed.channels).toEqual(['C0123456789', 'C9876543210'])
  })

  it('SIGNING_SECRET_RE rejects 64-char (round-1: narrowed to exactly 32)', async () => {
    const POST = await importHandler()
    const resp = await POST(
      mkRequest({ ...validBody(), signingSecret: 'a'.repeat(64) }),
      mkParams(),
    )
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { fieldErrors?: Record<string, string> }
    expect(json.fieldErrors?.signingSecret).toBeDefined()
  })
})

describe('POST /api/fleet/agents/:name/slack/credentials — partial failure', () => {
  it('returns 502 when SecretsManager call throws AccessDeniedException', async () => {
    mockHarnessService()
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('access denied'), {
        name: 'AccessDeniedException',
      }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('AccessDeniedException')
  })

  it('returns 502 when RegisterTaskDefinition fails', async () => {
    mockHarnessService()
    smSendMock
      .mockResolvedValueOnce({ ARN: 'arn:1' })
      .mockResolvedValueOnce({ ARN: 'arn:2' })
      .mockResolvedValueOnce({ ARN: 'arn:3' })
    mockTaskDef()
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('invalid'), {
        name: 'ClientException',
      }),
    )
    const POST = await importHandler()
    const resp = await POST(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ClientException')
  })
})
