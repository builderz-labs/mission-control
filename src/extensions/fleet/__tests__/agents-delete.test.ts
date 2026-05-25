import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import * as auth from '@/lib/auth'
import { logSecurityEvent } from '@/lib/security-events'

const ecsSendMock = vi.fn()
const elbv2SendMock = vi.fn()
const logsSendMock = vi.fn()
const smSendMock = vi.fn()
const iamSendMock = vi.fn()
const fetchMock = vi.fn()

// AWS SDK mock — same pattern as agents-create.test.ts. Each Command
// constructor wraps its input in a __type-tagged plain object so the
// test can introspect what the handler asked for.
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
  UpdateServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'UpdateServiceCommand',
    input,
  })),
  DeleteServiceCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteServiceCommand',
    input,
  })),
  ListTaskDefinitionsCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'ListTaskDefinitionsCommand',
    input,
  })),
  DeregisterTaskDefinitionCommand: vi
    .fn()
    .mockImplementation((input: unknown) => ({
      __type: 'DeregisterTaskDefinitionCommand',
      input,
    })),
}))

vi.mock('@aws-sdk/client-elastic-load-balancing-v2', () => ({
  ElasticLoadBalancingV2Client: vi
    .fn()
    .mockImplementation(() => ({ send: elbv2SendMock })),
  DescribeLoadBalancersCommand: vi
    .fn()
    .mockImplementation((input: unknown) => ({
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
  DescribeTargetGroupsCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeTargetGroupsCommand',
    input,
  })),
  DescribeTagsCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeTagsCommand',
    input,
  })),
  DeleteRuleCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteRuleCommand',
    input,
  })),
  DeleteTargetGroupCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteTargetGroupCommand',
    input,
  })),
}))

vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi
    .fn()
    .mockImplementation(() => ({ send: logsSendMock })),
  DeleteLogGroupCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteLogGroupCommand',
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

// #134: IAM SDK mock for the per-agent role teardown path.
// deleteAgentRoles issues:
//   DetachRolePolicy (exec) → DeleteRolePolicy (task) →
//   DeleteRolePolicy (exec) → DeleteRole (task) → DeleteRole (exec)
// = 5 IAM calls total on the happy teardown.
vi.mock('@aws-sdk/client-iam', () => ({
  IAMClient: vi.fn().mockImplementation(() => ({ send: iamSendMock })),
  CreateRoleCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateRoleCommand',
    input,
  })),
  GetRoleCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'GetRoleCommand',
    input,
  })),
  PutRolePolicyCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutRolePolicyCommand',
    input,
  })),
  DeleteRolePolicyCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteRolePolicyCommand',
    input,
  })),
  AttachRolePolicyCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'AttachRolePolicyCommand',
    input,
  })),
  DetachRolePolicyCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DetachRolePolicyCommand',
    input,
  })),
  DeleteRoleCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteRoleCommand',
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
  const mod = await import('../api/agents-delete')
  return mod.DELETE
}

const setRequiredEnv = () => {
  process.env.AWS_REGION = 'us-east-1'
  process.env.MC_FLEET_CLUSTER_NAME = 'ender-stack-dev'
  process.env.MC_FLEET_PROJECT_NAME = 'ender-stack'
  process.env.MC_FLEET_ENVIRONMENT = 'dev'
  process.env.MC_AGENT_LOG_GROUP_PREFIX = '/ecs/ender-stack-dev'
  // #354: when both are set, step 10 attempts /key/delete on the
  // LiteLLM proxy; when unset, step 10 emits a warning + skips.
  // (Step numbering updated round-2 audit: revoke moved from
  // between TG-delete and task-def-deregister to after
  // DeleteService + DeleteLogGroup.)
  process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN =
    'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/litellm-master-key-AbC123'
  process.env.MC_LITELLM_ALB_DNS_NAME =
    'internal-litellm.us-east-1.elb.amazonaws.com'
  process.env.MC_AGENT_SECRETS_NAME_PREFIX =
    'ender-stack/dev/companion-openclaw'
}

// Resource ARN/name fixtures matching the deterministic naming the
// handler derives from `prefix + agentName = ender-stack-dev-...-hello-bot`.
const PREFIX = 'ender-stack-dev'
const AGENT = 'hello-bot'
const SERVICE_NAME = `${PREFIX}-companion-openclaw-${AGENT}`
const SERVICE_ARN = `arn:aws:ecs:us-east-1:398152419239:service/${PREFIX}/${SERVICE_NAME}`
const TG_NAME = `${PREFIX}-agent-${AGENT}`
const TG_ARN = `arn:aws:elasticloadbalancing:us-east-1:398152419239:targetgroup/${TG_NAME}/abc123`
const ALB_ARN = `arn:aws:elasticloadbalancing:us-east-1:398152419239:loadbalancer/app/${PREFIX}-agents-shared/lb1`
const LISTENER_ARN = `arn:aws:elasticloadbalancing:us-east-1:398152419239:listener/app/${PREFIX}-agents-shared/lb1/lst1`
const RULE_ARN = `arn:aws:elasticloadbalancing:us-east-1:398152419239:listener-rule/app/${PREFIX}-agents-shared/lb1/lst1/r1`
const LOG_GROUP = `/ecs/${PREFIX}/companion-openclaw-${AGENT}`
const TASK_DEF_ARN_1 = `arn:aws:ecs:us-east-1:398152419239:task-definition/${SERVICE_NAME}:1`
const TASK_DEF_ARN_2 = `arn:aws:ecs:us-east-1:398152419239:task-definition/${SERVICE_NAME}:2`

const mkRequest = () =>
  ({
    url: `http://localhost/api/fleet/agents/${AGENT}`,
  }) as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]

const mkParams = (name: string = AGENT) => ({
  params: Promise.resolve({ name }),
})

/**
 * Happy-path mock chain. Order matches the handler's tear-down sequence:
 *   ecs:DescribeServices → ecs:UpdateService
 *   → elbv2:DescribeLBs → DescribeListeners → DescribeRules → DeleteRule
 *   → elbv2:DescribeTGs → DeleteTargetGroup
 *   → ecs:ListTaskDefinitions → DeregisterTaskDefinition (×2) → DeleteService
 *   → logs:DeleteLogGroup
 */
// #354: response helper for the LiteLLM /key/delete fetch.
const mkLiteLLMDeleteResponse = (status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ deleted: 1 }),
    json: async () => ({ deleted: 1 }),
  }) as unknown as Response

/**
 * #354: prime smSendMock + fetchMock so step 10 (LiteLLM /key/delete)
 * and step 11 (DeleteSecret) both succeed. Used by tests that bypass
 * happyPathMocks() but exercise the full teardown chain.
 */
const litellmDeleteMocks = () => {
  smSendMock
    .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
    .mockResolvedValueOnce({})
  fetchMock.mockResolvedValueOnce(mkLiteLLMDeleteResponse(200))
}

/**
 * #134: prime iamSendMock for the happy deleteAgentRoles() path.
 * Sequence: DetachRolePolicy (exec) → DeleteRolePolicy (task) →
 * DeleteRolePolicy (exec) → DeleteRole (task) → DeleteRole (exec).
 */
const primeIamDeleteHappy = () => {
  iamSendMock
    .mockResolvedValueOnce({}) // DetachRolePolicy exec
    .mockResolvedValueOnce({}) // DeleteRolePolicy task
    .mockResolvedValueOnce({}) // DeleteRolePolicy exec
    .mockResolvedValueOnce({}) // DeleteRole task
    .mockResolvedValueOnce({}) // DeleteRole exec
}

const happyPathMocks = () => {
  ecsSendMock.mockReset()
  elbv2SendMock.mockReset()
  logsSendMock.mockReset()
  smSendMock.mockReset()
  iamSendMock.mockReset()
  fetchMock.mockReset()

  // #354 step 10: resolve master key → /key/delete → 200.
  // #354 step 11: DeleteSecret on the per-agent litellm secret.
  smSendMock
    .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' }) // master key read
    .mockResolvedValueOnce({}) // DeleteSecret OK
  fetchMock.mockResolvedValueOnce(mkLiteLLMDeleteResponse(200))

  // #134 step 12: IAM role teardown.
  primeIamDeleteHappy()

  ecsSendMock
    // 1. DescribeServices — service exists, ACTIVE, agent-harness + MC-managed
    .mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'mission-control' },
          ],
        },
      ],
    })
    // 2. UpdateService desired=0
    .mockResolvedValueOnce({})
    // (ELBv2 calls happen between here and the next ECS call)
    // 7. ListTaskDefinitions
    .mockResolvedValueOnce({
      taskDefinitionArns: [TASK_DEF_ARN_1, TASK_DEF_ARN_2],
    })
    // 7. DeregisterTaskDefinition (×2)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    // 8. DeleteService force=true
    .mockResolvedValueOnce({})

  elbv2SendMock
    // 3. DescribeLoadBalancers
    .mockResolvedValueOnce({
      LoadBalancers: [{ LoadBalancerArn: ALB_ARN }],
    })
    // 3. DescribeListeners
    .mockResolvedValueOnce({
      Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
    })
    // 3. DescribeRules
    .mockResolvedValueOnce({
      Rules: [
        {
          RuleArn: RULE_ARN,
          Conditions: [
            { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
          ],
        },
      ],
    })
    // 4. DeleteRule
    .mockResolvedValueOnce({})
    // 5. DescribeTargetGroups
    .mockResolvedValueOnce({
      TargetGroups: [{ TargetGroupArn: TG_ARN }],
    })
    // 6. DeleteTargetGroup
    .mockResolvedValueOnce({})

  // 9. DeleteLogGroup (last)
  logsSendMock.mockResolvedValueOnce({})
}

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
  elbv2SendMock.mockReset()
  logsSendMock.mockReset()
  smSendMock.mockReset()
  iamSendMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DELETE /api/fleet/agents/:name — happy path', () => {
  it('tears down all 5 resource categories and returns 200 with deletedResources populated', async () => {
    happyPathMocks()
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      ok: boolean
      agentName: string
      deletedResources: Record<string, unknown>
      warnings: Array<{ code: string }>
    }
    expect(json.ok).toBe(true)
    expect(json.agentName).toBe(AGENT)
    expect(json.deletedResources).toEqual({
      serviceArn: SERVICE_ARN,
      listenerRuleArn: RULE_ARN,
      targetGroupArn: TG_ARN,
      logGroup: LOG_GROUP,
      taskDefinitionRevisions: [TASK_DEF_ARN_1, TASK_DEF_ARN_2],
      // #354: per-agent LiteLLM virtual key + Secrets Manager
      // secret are revoked alongside the AWS resources. The
      // secret name uses MC_AGENT_SECRETS_NAME_PREFIX (slash-form)
      // rather than the fleet prefix (dash-form).
      litellmKeyAlias: `${PREFIX}-${AGENT}`,
      litellmSecretName: `ender-stack/dev/companion-openclaw-${AGENT}-litellm-key`,
      // #134: per-agent IAM task + exec role names deleted in step 12.
      iamRolesDeleted: [
        `${PREFIX}-companion-openclaw-${AGENT}-task`,
        `${PREFIX}-companion-openclaw-${AGENT}-exec`,
      ],
    })
    expect(json.warnings).toEqual([])
  })

  it('issues UpdateService desiredCount=0 before any delete call', async () => {
    happyPathMocks()
    const DELETE = await importHandler()
    await DELETE(mkRequest(), mkParams())
    const updateCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'UpdateServiceCommand',
    )
    expect(updateCall).toBeDefined()
    const input = (updateCall![0] as { input: Record<string, unknown> }).input
    expect(input.desiredCount).toBe(0)
    expect(input.service).toBe(SERVICE_NAME)
  })

  it('passes force=true on DeleteService', async () => {
    happyPathMocks()
    const DELETE = await importHandler()
    await DELETE(mkRequest(), mkParams())
    const delCall = ecsSendMock.mock.calls.find(
      (c) => (c[0] as { __type: string }).__type === 'DeleteServiceCommand',
    )
    expect(delCall).toBeDefined()
    const input = (delCall![0] as { input: Record<string, unknown> }).input
    expect(input.force).toBe(true)
  })

  it('deletes log group AFTER deleting the service (avoids losing tail buffer)', async () => {
    // Auditor flag (ender-stack PR #262 round-1): DeleteLogGroup before
    // DeleteService risks losing the awslogs driver's final flush as
    // containers shut down. Order asserted explicitly so a future
    // refactor can't silently revert this.
    happyPathMocks()
    const DELETE = await importHandler()
    await DELETE(mkRequest(), mkParams())
    const deleteServiceCallIdx = ecsSendMock.mock.invocationCallOrder.find(
      (_, i) =>
        (ecsSendMock.mock.calls[i]?.[0] as { __type: string })?.__type ===
        'DeleteServiceCommand',
    )
    const deleteLogGroupCallIdx =
      logsSendMock.mock.invocationCallOrder[
        logsSendMock.mock.calls.findIndex(
          (c) => (c[0] as { __type: string }).__type === 'DeleteLogGroupCommand',
        )
      ]
    expect(deleteServiceCallIdx).toBeDefined()
    expect(deleteLogGroupCallIdx).toBeDefined()
    expect(deleteLogGroupCallIdx).toBeGreaterThan(deleteServiceCallIdx!)
  })
})

describe('DELETE /api/fleet/agents/:name — idempotency', () => {
  it('returns 200 with warning when listener rule is already gone', async () => {
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    litellmDeleteMocks()

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // UpdateService
      .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions empty
      .mockResolvedValueOnce({}) // DeleteService

    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      // DescribeRules returns no matching rule for this agent
      .mockResolvedValueOnce({ Rules: [] })
      // DescribeTargetGroups returns the TG (still present)
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({}) // DeleteTargetGroup

    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { listenerRuleArn?: string }
      warnings: Array<{ code: string }>
    }
    expect(json.deletedResources.listenerRuleArn).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain(
      'listener-rule-not-found',
    )
  })

  it('returns 200 with warning when log group is already gone (DeleteLogGroup → ResourceNotFoundException)', async () => {
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    litellmDeleteMocks()

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})

    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})

    const notFoundErr = Object.assign(new Error('Log group not found'), {
      name: 'ResourceNotFoundException',
    })
    logsSendMock.mockRejectedValueOnce(notFoundErr)

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { logGroup?: string }
      warnings: Array<{ code: string }>
    }
    expect(json.deletedResources.logGroup).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain(
      'log-group-already-deleted',
    )
  })

  it('returns 200 with warning when target group is already gone (DescribeTargetGroups → TargetGroupNotFoundException)', async () => {
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    // TG already gone → step 10 (LiteLLM revoke) still runs at the
    // end of the chain; step 11 (SM DeleteSecret) still runs after.
    litellmDeleteMocks()

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})

    const tgNotFound = Object.assign(new Error('TG not found'), {
      name: 'TargetGroupNotFoundException',
    })
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      // DescribeTargetGroups throws — TG already deleted
      .mockRejectedValueOnce(tgNotFound)

    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      warnings: Array<{ code: string }>
    }
    expect(json.warnings.map((w) => w.code)).toContain('target-group-not-found')
  })
})

describe('DELETE /api/fleet/agents/:name — sibling-family safety', () => {
  it('does NOT deregister task-defs from sibling families that share the prefix (e.g. delete `bot` must not touch `bot-test`)', async () => {
    // ListTaskDefinitions familyPrefix is a PREFIX match, not exact —
    // `familyPrefix=bot` returns revisions for `bot`, `bot-test`,
    // `bot-2026`, etc. The handler filters returned ARNs back to the
    // EXACT family before deregistering. Without this filter, deleting
    // a short-named agent would silently deregister another agent's
    // task-defs.
    litellmDeleteMocks()
    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // UpdateService
      // ListTaskDefinitions returns ARNs for BOTH the target family
      // (`...-hello-bot`) and a sibling family (`...-hello-bot-test`).
      .mockResolvedValueOnce({
        taskDefinitionArns: [
          TASK_DEF_ARN_1, // ender-stack-dev-companion-openclaw-hello-bot:1
          // Sibling: same prefix + `-test` suffix
          'arn:aws:ecs:us-east-1:398152419239:task-definition/ender-stack-dev-companion-openclaw-hello-bot-test:1',
          TASK_DEF_ARN_2, // ender-stack-dev-companion-openclaw-hello-bot:2
        ],
      })
      .mockResolvedValueOnce({}) // DeregisterTaskDefinition (only for matching family)
      .mockResolvedValueOnce({}) // DeregisterTaskDefinition (only for matching family)
      .mockResolvedValueOnce({}) // DeleteService

    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})

    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { taskDefinitionRevisions?: string[] }
    }
    // Exactly the 2 ARNs for the target family — sibling NOT deregistered
    expect(json.deletedResources.taskDefinitionRevisions).toEqual([
      TASK_DEF_ARN_1,
      TASK_DEF_ARN_2,
    ])
    expect(
      json.deletedResources.taskDefinitionRevisions?.find((arn) =>
        arn.includes('hello-bot-test'),
      ),
    ).toBeUndefined()
    // DeregisterTaskDefinition was called exactly TWICE — once per
    // matching ARN. Sibling skipped; counted by inspecting the mock
    // call list rather than relying on call count (which mixes
    // describe + delete).
    const deregCalls = ecsSendMock.mock.calls.filter(
      (c) =>
        (c[0] as { __type: string }).__type ===
        'DeregisterTaskDefinitionCommand',
    )
    expect(deregCalls).toHaveLength(2)
  })
})

describe('DELETE /api/fleet/agents/:name — refusal paths', () => {
  it('refuses non-MC-managed agent with 404 (smoke-test protection)', async () => {
    // Smoke-test has Component=agent-harness but ManagedBy=terraform —
    // teardown-protected by Terraform state, not this endpoint.
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'terraform' },
          ],
        },
      ],
    })
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ServiceNotFoundException')
    // Defense-in-depth: confirm no destructive AWS calls fired
    expect(ecsSendMock).toHaveBeenCalledTimes(1) // only DescribeServices
    expect(elbv2SendMock).not.toHaveBeenCalled()
    expect(logsSendMock).not.toHaveBeenCalled()
  })

  it('refuses non-harness platform service with 404 (e.g. mission-control itself)', async () => {
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          tags: [
            { key: 'Component', value: 'platform' },
            { key: 'ManagedBy', value: 'terraform' },
          ],
        },
      ],
    })
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
  })

  // #480 (ender-stack#480 Risk 2): absent-service ownership guard. The
  // isAgentHarness service tag-guard can't run with no service to inspect,
  // so the handler falls back to the per-agent target group's tags as
  // ownership proof before tearing anything down.
  describe('absent-service ownership guard (#480)', () => {
    it('refuses with 404 when service is absent but the target group is NOT MC-managed (terraform-managed)', async () => {
      vi.mocked(logSecurityEvent).mockClear()
      // Service absent (mid terraform apply/destroy/replacement), but its
      // target group survives carrying ManagedBy=terraform. Deleting its
      // downstream resources via the API would conflict with TF state.
      ecsSendMock.mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
      elbv2SendMock
        .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] }) // guard: DescribeTargetGroups
        .mockResolvedValueOnce({
          TagDescriptions: [
            {
              ResourceArn: TG_ARN,
              Tags: [
                { Key: 'Component', Value: 'agent-harness' },
                { Key: 'ManagedBy', Value: 'terraform' },
              ],
            },
          ],
        }) // guard: DescribeTags — foreign

      const DELETE = await importHandler()
      const resp = await DELETE(mkRequest(), mkParams())

      expect(resp.status).toBe(404)
      const json = (await resp.json()) as { error: string }
      expect(json.error).toBe('ServiceNotFoundException')
      // Security event surfaces the real refusal reason (404 alone is
      // indistinguishable from the non-harness refusal).
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'fleet.delete-agent.refused-non-mc-downstream',
        }),
      )
      // Defense-in-depth: only the two read-only guard calls fired — no
      // drain/delete on any downstream resource.
      expect(ecsSendMock).toHaveBeenCalledTimes(1) // DescribeServices only
      expect(elbv2SendMock).toHaveBeenCalledTimes(2) // DescribeTargetGroups + DescribeTags
      const elbv2Types = elbv2SendMock.mock.calls.map(
        (c) => (c[0] as { __type: string }).__type,
      )
      expect(elbv2Types).toEqual(['DescribeTargetGroupsCommand', 'DescribeTagsCommand'])
      expect(logsSendMock).not.toHaveBeenCalled()
      expect(smSendMock).not.toHaveBeenCalled()
      expect(iamSendMock).not.toHaveBeenCalled()
    })

    it('proceeds with teardown when service is absent but the target group IS MC-managed', async () => {
      vi.mocked(logSecurityEvent).mockClear()
      litellmDeleteMocks()
      ecsSendMock
        .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
        .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions
      elbv2SendMock
        .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] }) // guard: DescribeTargetGroups
        .mockResolvedValueOnce({
          TagDescriptions: [
            {
              ResourceArn: TG_ARN,
              Tags: [
                { Key: 'Component', Value: 'agent-harness' },
                { Key: 'ManagedBy', Value: 'mission-control' },
              ],
            },
          ],
        }) // guard: DescribeTags — MC-managed
        .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
        .mockResolvedValueOnce({
          Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
        })
        .mockResolvedValueOnce({ Rules: [] })
        .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
        .mockResolvedValueOnce({}) // DeleteTargetGroup
      logsSendMock.mockResolvedValueOnce({})

      const DELETE = await importHandler()
      const resp = await DELETE(mkRequest(), mkParams())

      expect(resp.status).toBe(200)
      const json = (await resp.json()) as { warnings: Array<{ code: string }> }
      expect(json.warnings.map((w) => w.code)).toContain('service-not-found')
      // No refusal logged on the MC-managed path.
      expect(vi.mocked(logSecurityEvent)).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'fleet.delete-agent.refused-non-mc-downstream',
        }),
      )
    })

    it('proceeds with teardown when service is absent and the target group is also absent', async () => {
      vi.mocked(logSecurityEvent).mockClear()
      litellmDeleteMocks()
      ecsSendMock
        .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
        .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions
      elbv2SendMock
        .mockResolvedValueOnce({ TargetGroups: [] }) // guard: TG absent → 'absent', no DescribeTags
        .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
        .mockResolvedValueOnce({
          Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
        })
        .mockResolvedValueOnce({ Rules: [] })
        .mockResolvedValueOnce({ TargetGroups: [] })
      logsSendMock.mockResolvedValueOnce({})

      const DELETE = await importHandler()
      const resp = await DELETE(mkRequest(), mkParams())

      expect(resp.status).toBe(200)
      // Guard short-circuits at 'absent' — no DescribeTags call.
      const elbv2Types = elbv2SendMock.mock.calls.map(
        (c) => (c[0] as { __type: string }).__type,
      )
      expect(elbv2Types).not.toContain('DescribeTagsCommand')
      expect(vi.mocked(logSecurityEvent)).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'fleet.delete-agent.refused-non-mc-downstream',
        }),
      )
    })

    it('proceeds (does NOT 502) when the target group vanishes between resolution and DescribeTags (TOCTOU)', async () => {
      // Greptile P2 / Claude audit: the TG can be deleted between
      // findTargetGroupArn and DescribeTags (concurrent teardown, or a
      // TF replacement completing). DescribeTags then throws
      // TargetGroupNotFoundException — the guard treats it as 'absent'
      // so an idempotent re-delete doesn't 502 on a resource that's
      // already gone.
      vi.mocked(logSecurityEvent).mockClear()
      litellmDeleteMocks()
      const tgGone = Object.assign(new Error('gone'), {
        name: 'TargetGroupNotFoundException',
      })
      ecsSendMock
        .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
        .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions
      elbv2SendMock
        .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] }) // guard: DescribeTargetGroups — TG still there
        .mockRejectedValueOnce(tgGone) // guard: DescribeTags — TG vanished
        .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
        .mockResolvedValueOnce({
          Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
        })
        .mockResolvedValueOnce({ Rules: [] })
        .mockResolvedValueOnce({ TargetGroups: [] })
      logsSendMock.mockResolvedValueOnce({})

      const DELETE = await importHandler()
      const resp = await DELETE(mkRequest(), mkParams())

      expect(resp.status).toBe(200)
      expect(vi.mocked(logSecurityEvent)).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'fleet.delete-agent.refused-non-mc-downstream',
        }),
      )
    })
  })

  it('continues teardown when service does not exist (idempotent, #478)', async () => {
    // #478: a partial-creation (service never came up) or a re-delete
    // of an already-torn-down agent leaves the ECS service entirely
    // absent. The handler used to 404 here, stranding the listener
    // rule / TG / log group / task-defs / LiteLLM key / secret / IAM
    // roles. It now treats the missing service as a no-op and continues
    // the idempotent teardown of every downstream resource (200, same
    // contract as the INACTIVE path).
    litellmDeleteMocks()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
      // No UpdateService / DeleteService mocks: the absent branch skips
      // both, exactly like the INACTIVE branch.
      .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions

    elbv2SendMock
      // #480 absent-path ownership guard: DescribeTargetGroups +
      // DescribeTags. TG survives and is MC-managed → guard passes, the
      // idempotent teardown continues.
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({
        TagDescriptions: [
          {
            ResourceArn: TG_ARN,
            Tags: [
              { Key: 'Component', Value: 'agent-harness' },
              { Key: 'ManagedBy', Value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // DeleteRule
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({}) // DeleteTargetGroup

    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { serviceArn?: string; listenerRuleArn?: string }
      warnings: Array<{ code: string }>
    }
    // Service never existed — not in deletedResources, flagged as a warning
    expect(json.deletedResources.serviceArn).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain('service-not-found')
    // But everything downstream was still cleaned up
    expect(json.deletedResources.listenerRuleArn).toBe(RULE_ARN)
    // Defense-in-depth: NO destructive ECS calls (drain / delete) fired —
    // only DescribeServices + ListTaskDefinitions.
    expect(ecsSendMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT 404-refuse when service is absent — harness tag-guard is skipped (not bypassed for existing services)', async () => {
    // #478 security boundary: the isAgentHarness tag-guard cannot run
    // on an absent service (no tags to inspect), so the absent path
    // skips it and proceeds. This is distinct from the
    // service-EXISTS-but-not-a-harness path (above), which still
    // returns a 404 refusal. Assert the absent path is NOT treated as
    // a refusal: response is 200, not the 404 ServiceNotFoundException
    // the guard returns.
    litellmDeleteMocks()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
      .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions
    elbv2SendMock
      // #480 ownership guard: TG also absent → 'absent' verdict → no
      // DescribeTags, continue teardown. (No surviving downstream
      // resource to attribute, so nothing to protect.)
      .mockResolvedValueOnce({ TargetGroups: [] })
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({ Rules: [] })
      .mockResolvedValueOnce({ TargetGroups: [] })
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).not.toBe(404)
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as { error?: string }
    expect(json.error).not.toBe('ServiceNotFoundException')
  })

  it('continues teardown when service is already INACTIVE (idempotent retry path)', async () => {
    // Round-1 audit on PR #43 caught a stuck-state: a prior DELETE
    // that succeeded at DeleteService but failed downstream (e.g.
    // DeleteLogGroup before the IAM grant in PR #262 applied) leaves
    // the service INACTIVE while listener rule / TG / log group
    // still exist. 404'ing on retry would strand those resources.
    // INACTIVE is now treated as "ECS portion already done, finish
    // the rest" — handler returns 200 with a warning instead.
    litellmDeleteMocks()
    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'INACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      // Note: no UpdateService / DeleteService mocks because the
      // INACTIVE branch skips both.
      .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions

    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // DeleteRule
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({}) // DeleteTargetGroup

    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { serviceArn?: string; listenerRuleArn?: string }
      warnings: Array<{ code: string }>
    }
    // Service was already gone — not in deletedResources
    expect(json.deletedResources.serviceArn).toBeUndefined()
    // But everything downstream was cleaned up
    expect(json.deletedResources.listenerRuleArn).toBe(RULE_ARN)
    expect(json.warnings.map((w) => w.code)).toContain('service-already-deleted')
  })
})

describe('DELETE /api/fleet/agents/:name — auth + validation', () => {
  it('returns 403 when caller is not admin', async () => {
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Forbidden',
      status: 403,
    } as unknown as ReturnType<typeof auth.requireRole>)
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(403)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 when agentName fails the regex (security boundary)', async () => {
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams('UPPERCASE-NAME'))
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('InvalidAgentName')
    // Defense-in-depth: NO AWS calls — handler short-circuits on
    // bad name before reaching DescribeServices.
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(elbv2SendMock).not.toHaveBeenCalled()
    expect(logsSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 when agentName is empty', async () => {
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams(''))
    expect(resp.status).toBe(400)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/fleet/agents/:name — partial failure', () => {
  it('returns 502 with deletedResources + failedResources when DeleteRule throws AccessDenied', async () => {
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({}) // UpdateService

    const accessDenied = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDeniedException',
    })
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockRejectedValueOnce(accessDenied) // DeleteRule throws

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      deletedResources?: Record<string, unknown>
      failedResources?: Record<string, unknown>
    }
    expect(json.error).toBe('AccessDeniedException')
    // Service was DISCOVERED in step 1 but NEVER DELETED — so it
    // belongs in failedResources, not deletedResources. The
    // contract is: deletedResources lists actual successful deletes,
    // failedResources lists what the operator must clean up
    // manually. (The discovered ARN appears in failedResources so
    // the operator has the full ARN, not just the service name.)
    expect(json.deletedResources?.serviceArn).toBeUndefined()
    expect(json.failedResources).toBeDefined()
    expect(json.failedResources?.serviceArn).toBe(SERVICE_ARN)
    expect(json.failedResources?.listenerRuleArn).toBeDefined()
    expect(json.failedResources?.logGroup).toBeDefined()
    expect(json.failedResources?.taskDefinitionRevisions).toBeDefined()
  })

  it('502 on absent-service path does NOT list serviceArn in failedResources (#478)', async () => {
    // Regression for the absent-service catch-block fix: when
    // DescribeServices proved the service absent (serviceWasAbsent),
    // a later non-idempotent failure must not tell the operator to
    // clean up a service that never existed. The OTHER resources still
    // appear in failedResources (they may exist for a partially-created
    // agent), but serviceArn is intentionally omitted.
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()

    ecsSendMock.mockResolvedValueOnce({ services: [] }) // absent — drain skipped

    const accessDenied = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDeniedException',
    })
    elbv2SendMock
      // #480 ownership guard fires first on the absent path: TG present
      // + MC-managed → guard passes, teardown proceeds to DeleteRule.
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({
        TagDescriptions: [
          {
            ResourceArn: TG_ARN,
            Tags: [
              { Key: 'Component', Value: 'agent-harness' },
              { Key: 'ManagedBy', Value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockRejectedValueOnce(accessDenied) // DeleteRule throws → outer catch

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      error: string
      deletedResources?: Record<string, unknown>
      failedResources?: Record<string, unknown>
    }
    expect(json.error).toBe('AccessDeniedException')
    // The fix: serviceArn omitted because the service was proven absent.
    expect(json.failedResources?.serviceArn).toBeUndefined()
    expect(json.deletedResources?.serviceArn).toBeUndefined()
    // Other resources still surfaced for manual cleanup.
    expect(json.failedResources?.logGroup).toBeDefined()
    expect(json.failedResources?.taskDefinitionRevisions).toBeDefined()
  })
})

describe('DELETE /api/fleet/agents/:name — per-agent LiteLLM virtual key (#354)', () => {
  it('revokes the per-agent virtual key via /key/delete and schedules the SM secret for deletion', async () => {
    happyPathMocks()
    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)

    // /key/delete called with the deterministic alias.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://internal-litellm.us-east-1.elb.amazonaws.com/key/delete',
    )
    const body = JSON.parse(init.body as string)
    expect(body.key_aliases).toEqual([`${PREFIX}-${AGENT}`])

    // Secrets Manager: GetSecretValue (master) → DeleteSecret (per-agent).
    const smCalls = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(smCalls).toEqual(['GetSecretValueCommand', 'DeleteSecretCommand'])
    const deleteInput = (smSendMock.mock.calls[1][0] as {
      input: { SecretId: string; RecoveryWindowInDays: number }
    }).input
    expect(deleteInput.SecretId).toBe(
      `ender-stack/dev/companion-openclaw-${AGENT}-litellm-key`,
    )
    expect(deleteInput.RecoveryWindowInDays).toBe(7)
  })

  it('warns + continues when /key/delete returns 404 (idempotent)', async () => {
    // Master read OK, /key/delete 404 (alias not on the proxy),
    // SM DeleteSecret OK.
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockResolvedValueOnce({})
    fetchMock.mockResolvedValueOnce(mkLiteLLMDeleteResponse(404))

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { litellmKeyAlias?: string }
      warnings: Array<{ code: string }>
    }
    // Aligned with AWS resource already-deleted semantics (round-3
    // audit): when the resource was already gone, the field is
    // suppressed in deletedResources and the warning carries the
    // signal instead.
    expect(json.deletedResources.litellmKeyAlias).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain(
      'litellm-key-already-deleted',
    )
  })

  it('warns + continues when /key/delete returns 5xx — AWS teardown still completes', async () => {
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockResolvedValueOnce({})
    // #356: retriable 503 is retried MAX_POST_ATTEMPTS times.
    fetchMock.mockResolvedValue(mkLiteLLMDeleteResponse(503))

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    // Non-fatal — full AWS teardown still returns 200.
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { serviceArn?: string; litellmKeyAlias?: string }
      warnings: Array<{ code: string }>
    }
    expect(json.deletedResources.serviceArn).toBe(SERVICE_ARN)
    // Alias NOT in deletedResources because the revoke failed.
    expect(json.deletedResources.litellmKeyAlias).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain(
      'litellm-key-revoke-failed',
    )
  })

  it('emits a warning + skips /key/delete when BOTH MC_LITELLM_MASTER_KEY_SECRET_ARN and MC_LITELLM_ALB_DNS_NAME are unset (best-effort cleanup)', async () => {
    delete process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN
    delete process.env.MC_LITELLM_ALB_DNS_NAME
    // SM still gets the DeleteSecret call for step 10.
    smSendMock.mockResolvedValueOnce({})

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    // Never called /key/delete — env was unset.
    expect(fetchMock).not.toHaveBeenCalled()
    const json = (await resp.json()) as {
      warnings: Array<{ code: string }>
    }
    expect(json.warnings.map((w) => w.code)).toContain(
      'litellm-key-revoke-skipped',
    )
  })

  it('runs /key/delete AFTER DeleteService + DeleteLogGroup, not between TG and task-def deregister (#354 round-2)', async () => {
    // Greptile P1 "Key revoked too early": revoke must happen
    // after the agent's AWS surface is verified gone, so a
    // partial-failure in DeleteService doesn't leave an agent
    // alive with a revoked key.
    happyPathMocks()
    const DELETE = await importHandler()
    await DELETE(mkRequest(), mkParams())

    const fetchOrder = fetchMock.mock.invocationCallOrder[0]
    const deleteServiceOrder = ecsSendMock.mock.invocationCallOrder[
      ecsSendMock.mock.calls.findIndex(
        (c) =>
          (c[0] as { __type: string }).__type === 'DeleteServiceCommand',
      )
    ]
    const deleteLogGroupOrder =
      logsSendMock.mock.invocationCallOrder[
        logsSendMock.mock.calls.findIndex(
          (c) =>
            (c[0] as { __type: string }).__type === 'DeleteLogGroupCommand',
        )
      ]
    expect(fetchOrder).toBeGreaterThan(deleteServiceOrder)
    expect(fetchOrder).toBeGreaterThan(deleteLogGroupOrder)
  })

  it('does NOT delete the per-agent SM secret when /key/delete fails (preserves recovery path) (#354 round-2)', async () => {
    // Greptile P1 "Secret deleted after failed revoke": a
    // failed LiteLLM revoke leaves the key live, so the secret
    // must survive — operators read it to revoke manually.
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    smSendMock.mockReset()
    fetchMock.mockReset()

    // Master read OK → /key/delete 5xx (fails).
    smSendMock.mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
    // #356: retriable 503 is retried MAX_POST_ATTEMPTS times.
    fetchMock.mockResolvedValue(mkLiteLLMDeleteResponse(503))

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { litellmSecretName?: string }
      warnings: Array<{ code: string }>
    }
    // Crucially: NO DeleteSecret was called on the per-agent secret.
    const smCommands = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(smCommands).toEqual(['GetSecretValueCommand']) // only master read; no DeleteSecret
    expect(json.deletedResources.litellmSecretName).toBeUndefined()
    const codes = json.warnings.map((w) => w.code)
    expect(codes).toContain('litellm-key-revoke-failed')
    expect(codes).toContain('litellm-secret-delete-skipped')
  })

  it('suppresses `deleted.litellmSecretName` when the SM secret was already gone (round-6 audit, semantic alignment)', async () => {
    // Aligned with `deleted.litellmKeyAlias` semantics: the field
    // signals "this call did the cleanup", not "the resource is
    // now gone". When DeleteSecret returns ResourceNotFoundException,
    // the suppression + `litellm-secret-already-deleted` warning
    // is the operator-visible signal.
    ecsSendMock.mockReset()
    elbv2SendMock.mockReset()
    logsSendMock.mockReset()
    smSendMock.mockReset()
    fetchMock.mockReset()

    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' }) // master read for /key/delete
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      ) // DeleteSecret on step 11 → already gone
    fetchMock.mockResolvedValueOnce(mkLiteLLMDeleteResponse(200))

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { litellmSecretName?: string; litellmKeyAlias?: string }
      warnings: Array<{ code: string }>
    }
    // Field suppressed because the secret was already gone.
    expect(json.deletedResources.litellmSecretName).toBeUndefined()
    // Warning carries the signal instead.
    expect(json.warnings.map((w) => w.code)).toContain(
      'litellm-secret-already-deleted',
    )
  })

  it('PRESERVES the SM secret when only one of the two LiteLLM env vars is set (#354 round-4 audit C2)', async () => {
    // Asymmetric config: master-key ARN present, ALB DNS unset.
    // Without the C2 fix, the prior shape would have skipped revoke
    // AND deleted the SM secret — operator loses the recovery path
    // (read secret → manually revoke). Now preserved; warning code
    // litellm-key-revoke-config-incomplete signals the misconfig.
    delete process.env.MC_LITELLM_ALB_DNS_NAME
    // Note: MC_LITELLM_MASTER_KEY_SECRET_ARN stays set from setRequiredEnv.

    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({ Listeners: [{ ListenerArn: LISTENER_ARN }] })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)

    // /key/delete was NOT called (skip path).
    expect(fetchMock).not.toHaveBeenCalled()
    // SM DeleteSecret was NOT called (litellmKeyRevoked=false → step 11 skips).
    const smCommands = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(smCommands).not.toContain('DeleteSecretCommand')
    // Warning explicitly names the missing env var so operators can fix.
    const json = (await resp.json()) as { warnings: Array<{ code: string; message: string }> }
    const codes = json.warnings.map((w) => w.code)
    expect(codes).toContain('litellm-key-revoke-config-incomplete')
    const incompleteMsg = json.warnings.find(
      (w) => w.code === 'litellm-key-revoke-config-incomplete',
    )!.message
    expect(incompleteMsg).toContain('MC_LITELLM_ALB_DNS_NAME')
  })
})

describe('DELETE /api/fleet/agents/:name — per-agent IAM role cleanup (#134)', () => {
  // Match the AWS-resource already-deleted semantics elsewhere in
  // this handler: `deletedResources` is populated only when the
  // resource was actually present; a `*-already-deleted` warning
  // covers the fully-idempotent case. Avoids the ambiguous "we
  // deleted X" AND "X was already gone" state in the same response.

  const happyAwsTeardown = () => {
    smSendMock
      .mockResolvedValueOnce({ SecretString: 'sk-master-NEVER-LOG' })
      .mockResolvedValueOnce({})
    fetchMock.mockResolvedValueOnce(mkLiteLLMDeleteResponse(200))
    ecsSendMock
      .mockResolvedValueOnce({
        services: [
          {
            serviceArn: SERVICE_ARN,
            status: 'ACTIVE',
            tags: [
              { key: 'Component', value: 'agent-harness' },
              { key: 'ManagedBy', value: 'mission-control' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ taskDefinitionArns: [] })
      .mockResolvedValueOnce({})
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({
        Rules: [
          {
            RuleArn: RULE_ARN,
            Conditions: [
              { Field: 'path-pattern', Values: [`/agent/${AGENT}`] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ TargetGroups: [{ TargetGroupArn: TG_ARN }] })
      .mockResolvedValueOnce({})
    logsSendMock.mockResolvedValueOnce({})
  }

  it('omits iamRolesDeleted and warns "iam-roles-already-deleted" when BOTH roles are absent (idempotent re-run)', async () => {
    happyAwsTeardown()
    // All 5 IAM calls 4xx with NoSuchEntity — both roles absent.
    const noSuchEntity = Object.assign(new Error('absent'), {
      name: 'NoSuchEntity',
    })
    iamSendMock.mockRejectedValue(noSuchEntity)

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { iamRolesDeleted?: string[] }
      warnings: Array<{ code: string }>
    }
    // No fresh deletes ⇒ no iamRolesDeleted field.
    expect(json.deletedResources.iamRolesDeleted).toBeUndefined()
    expect(json.warnings.map((w) => w.code)).toContain(
      'iam-roles-already-deleted',
    )
  })

  it('populates failedResources.iamRolesDeleted when the outer catch fires (#134)', async () => {
    // Closes the Claude Auditor P1 from round 3: if an AWS error in
    // steps 1-11 fires, step 12 (IAM cleanup) never runs. Without
    // this, the 502 response listed ECS/ELB/CW resources to clean
    // up but said nothing about the IAM role pair — operator with
    // no context misses the orphan entirely.
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'mission-control' },
          ],
        },
      ],
    })
    // Step 2 UpdateService throws an unrecoverable AWS error.
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('Internal failure'), { name: 'ServerException' }),
    )

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as {
      failedResources: { iamRolesDeleted?: string[] }
    }
    expect(json.failedResources.iamRolesDeleted).toEqual([
      `${PREFIX}-companion-openclaw-${AGENT}-task`,
      `${PREFIX}-companion-openclaw-${AGENT}-exec`,
    ])
  })

  it('accepts legacy 21-32 char agent names for backward compat (#134)', async () => {
    // Closes the Claude Auditor P2 from round 3: tightening
    // AGENT_NAME_RE to 3-20 chars without a permissive DELETE regex
    // would strand existing agents created before this PR. The
    // DELETE handler uses AGENT_NAME_DELETE_RE (legacy 3-32) so
    // pre-existing 21-32 char agents remain teardown-eligible.
    const longName = 'a' + 'b'.repeat(23) + 'c' // 25 chars, legacy-valid
    // Absent service is fine for this test — we just need to assert the
    // regex check passes (not 400). Post-#478 an absent service no
    // longer 404s; it proceeds with idempotent teardown and returns
    // 200, so wire the downstream mocks like the absent-service test.
    litellmDeleteMocks()
    ecsSendMock
      .mockResolvedValueOnce({ services: [] }) // DescribeServices — absent
      .mockResolvedValueOnce({ taskDefinitionArns: [] }) // ListTaskDefinitions
    elbv2SendMock
      .mockResolvedValueOnce({ LoadBalancers: [{ LoadBalancerArn: ALB_ARN }] })
      .mockResolvedValueOnce({
        Listeners: [{ ListenerArn: LISTENER_ARN, Protocol: 'HTTP' }],
      })
      .mockResolvedValueOnce({ Rules: [] }) // no rule for this name — warning, continue
      .mockResolvedValueOnce({ TargetGroups: [] }) // no TG — warning, continue
    logsSendMock.mockResolvedValueOnce({})

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams(longName))
    // 200 (idempotent teardown, #478) — and crucially NOT 400
    // InvalidAgentName: the legacy-length name passed the regex.
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      error?: string
      warnings: Array<{ code: string }>
    }
    expect(json.error).not.toBe('InvalidAgentName')
    expect(json.warnings.map((w) => w.code)).toContain('service-not-found')
  })

  it('reports only the fresh role in iamRolesDeleted when one role is absent (partial idempotent)', async () => {
    happyAwsTeardown()
    // Detach succeeds, DeleteRolePolicy task succeeds, DeleteRolePolicy
    // exec NoSuchEntity, DeleteRole task succeeds, DeleteRole exec
    // NoSuchEntity. The exec role pre-existed only as a detached
    // shell (no inline) and got removed in a prior partial run; the
    // task role is still fresh.
    const noSuchEntity = Object.assign(new Error('absent'), {
      name: 'NoSuchEntity',
    })
    iamSendMock
      .mockResolvedValueOnce({}) // Detach exec — succeeds
      .mockResolvedValueOnce({}) // Delete inline task
      .mockRejectedValueOnce(noSuchEntity) // Delete inline exec — gone
      .mockResolvedValueOnce({}) // Delete role task
      .mockRejectedValueOnce(noSuchEntity) // Delete role exec — gone

    const DELETE = await importHandler()
    const resp = await DELETE(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      deletedResources: { iamRolesDeleted?: string[] }
      warnings: Array<{ code: string }>
    }
    // Only the task role is reported fresh.
    expect(json.deletedResources.iamRolesDeleted).toEqual([
      `${PREFIX}-companion-openclaw-${AGENT}-task`,
    ])
    expect(json.warnings.map((w) => w.code)).toContain(
      'iam-roles-partially-already-gone',
    )
    // Crucially: NOT the fully-gone warning code (mutually exclusive).
    expect(json.warnings.map((w) => w.code)).not.toContain(
      'iam-roles-already-deleted',
    )
  })
})
