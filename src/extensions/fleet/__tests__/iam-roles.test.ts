import { beforeEach, describe, expect, it, vi } from 'vitest'

const iamSendMock = vi.fn()

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

const importModule = async () => {
  const mod = await import('../lib/iam-roles')
  return mod
}

const TASK_ROLE_ARN =
  'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-hello-bot-task'
const EXEC_ROLE_ARN =
  'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-hello-bot-exec'

const baseInput = () => ({
  agentName: 'hello-bot',
  prefix: 'ender-stack-dev',
  boundaryArn:
    'arn:aws:iam::398152419239:policy/ender-stack-dev-mc-agent-boundary',
  accountId: '398152419239',
  region: 'us-east-1',
  secretsKmsKeyArn:
    'arn:aws:kms:us-east-1:398152419239:key/abcdef01-2345-6789-abcd-ef0123456789',
  secretsNamePrefix: 'ender-stack/dev/companion-openclaw',
  logGroupPrefix: '/ecs/ender-stack-dev',
  projectName: 'ender-stack',
  environment: 'dev',
})

const primeMintHappy = () => {
  iamSendMock
    .mockResolvedValueOnce({ Role: { Arn: TASK_ROLE_ARN } }) // CreateRole task
    .mockResolvedValueOnce({ Role: { Arn: EXEC_ROLE_ARN } }) // CreateRole exec
    .mockResolvedValueOnce({}) // PutRolePolicy task
    .mockResolvedValueOnce({}) // PutRolePolicy exec
    .mockResolvedValueOnce({}) // AttachRolePolicy exec
}

beforeEach(() => {
  iamSendMock.mockReset()
  process.env.AWS_REGION = 'us-east-1'
})

describe('mintAgentRoles — invariants (#134)', () => {
  it('uses the frozen ecs-tasks.amazonaws.com trust policy on both CreateRole calls', async () => {
    primeMintHappy()
    const { mintAgentRoles, TRUST_POLICY } = await importModule()
    await mintAgentRoles(baseInput())

    const createCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'CreateRoleCommand',
    )
    expect(createCalls).toHaveLength(2)
    // Trust policy is byte-identical between calls and matches the
    // exported constant. AWS provides no IAM condition to constrain
    // AssumeRolePolicyDocument content, so the load-bearing invariant
    // is that this string never threads operator input.
    const expectedTrust = TRUST_POLICY
    for (const call of createCalls) {
      const input = (call[0] as { input: Record<string, unknown> }).input
      expect(input.AssumeRolePolicyDocument).toBe(expectedTrust)
    }
    // The trust policy resolves to a single Allow → sts:AssumeRole
    // for the ECS tasks service principal. Nothing else.
    const parsed = JSON.parse(expectedTrust) as {
      Statement: Array<{
        Effect: string
        Principal: Record<string, string>
        Action: string
      }>
    }
    expect(parsed.Statement).toHaveLength(1)
    expect(parsed.Statement[0].Effect).toBe('Allow')
    expect(parsed.Statement[0].Principal).toEqual({
      Service: 'ecs-tasks.amazonaws.com',
    })
    expect(parsed.Statement[0].Action).toBe('sts:AssumeRole')
  })

  it('attaches the permissions boundary on both CreateRole calls', async () => {
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    const input = baseInput()
    await mintAgentRoles(input)

    const createCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'CreateRoleCommand',
    )
    for (const call of createCalls) {
      const cmd = (call[0] as { input: Record<string, unknown> }).input
      expect(cmd.PermissionsBoundary).toBe(input.boundaryArn)
    }
  })

  it('always tags ManagedBy=mission-control + Component=companion-openclaw', async () => {
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    await mintAgentRoles(baseInput())

    const createCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'CreateRoleCommand',
    )
    for (const call of createCalls) {
      const tags = (call[0] as { input: { Tags: Array<{ Key: string; Value: string }> } })
        .input.Tags
      // ManagedBy condition on iam:CreateRole implicit-denies any
      // call missing the tag (PR #381 boundary), so this is a
      // load-bearing invariant.
      expect(tags).toContainEqual({ Key: 'ManagedBy', Value: 'mission-control' })
      expect(tags).toContainEqual({
        Key: 'Component',
        Value: 'companion-openclaw',
      })
      // Provenance + identity tags for downstream operator search:
      expect(tags).toContainEqual({ Key: 'AgentName', Value: 'hello-bot' })
      expect(tags).toContainEqual({ Key: 'Project', Value: 'ender-stack' })
      expect(tags).toContainEqual({ Key: 'Environment', Value: 'dev' })
    }
  })

  it('uses deterministic role names matching the IAM grant resource pattern', async () => {
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    await mintAgentRoles(baseInput())

    const createCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'CreateRoleCommand',
    )
    const names = createCalls.map(
      (c) =>
        (c[0] as { input: { RoleName: string } }).input.RoleName,
    )
    expect(names).toEqual([
      'ender-stack-dev-companion-openclaw-hello-bot-task',
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    ])
  })

  it('scopes the task-role inline policy secret ARN to {agentName}-* (not *)', async () => {
    // Load-bearing cross-agent isolation invariant. The boundary
    // caps secrets at `companion-openclaw-*`, so the inline policy
    // is the *only* primitive preventing agent A from reading
    // agent B's secrets within that namespace.
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    await mintAgentRoles(baseInput())

    const putRolePolicyCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'PutRolePolicyCommand',
    )
    expect(putRolePolicyCalls.length).toBeGreaterThanOrEqual(1)
    // Task role policy is the first PutRolePolicy call.
    const taskInputDoc = (
      putRolePolicyCalls[0][0] as {
        input: { PolicyDocument: string; RoleName: string }
      }
    ).input
    expect(taskInputDoc.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-task',
    )
    const taskPolicy = JSON.parse(taskInputDoc.PolicyDocument) as {
      Statement: Array<{
        Sid: string
        Action: string | string[]
        Resource: string | string[]
      }>
    }
    const secretsStmt = taskPolicy.Statement.find(
      (s) => s.Sid === 'AgentSecretsRead',
    )
    expect(secretsStmt).toBeDefined()
    // The literal {agentName}-* scope is the load-bearing isolation
    // primitive. Cross-checked here.
    expect(secretsStmt!.Resource).toBe(
      'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-*',
    )
    // Log ARN scope — must reference the EXACT log group name
    // (no `-*` suffix). MC pre-creates `/ecs/{prefix}/companion-
    // openclaw-{agentName}` as the literal group; an inline policy
    // that only matches `{agentName}-*` 403s CreateLogStream at
    // task launch. The `:*` variant matches log streams within
    // the group.
    const logStmt = taskPolicy.Statement.find(
      (s) => s.Sid === 'AgentLogWrites',
    )
    expect(logStmt).toBeDefined()
    expect(logStmt!.Resource).toEqual([
      'arn:aws:logs:us-east-1:398152419239:log-group:/ecs/ender-stack-dev/companion-openclaw-hello-bot',
      'arn:aws:logs:us-east-1:398152419239:log-group:/ecs/ender-stack-dev/companion-openclaw-hello-bot:*',
    ])
  })

  it('scopes the exec-role inline policy secret ARN to {agentName}-* (not *)', async () => {
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    await mintAgentRoles(baseInput())

    const putRolePolicyCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'PutRolePolicyCommand',
    )
    expect(putRolePolicyCalls).toHaveLength(2)
    // Exec role policy is the second PutRolePolicy call.
    const execInputDoc = (
      putRolePolicyCalls[1][0] as {
        input: { PolicyDocument: string; RoleName: string }
      }
    ).input
    expect(execInputDoc.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
    const execPolicy = JSON.parse(execInputDoc.PolicyDocument) as {
      Statement: Array<{
        Sid: string
        Action: string | string[]
        Resource: string | string[]
      }>
    }
    const secretsStmt = execPolicy.Statement.find(
      (s) => s.Sid === 'AgentSecretsRead',
    )
    expect(secretsStmt).toBeDefined()
    expect(secretsStmt!.Resource).toBe(
      'arn:aws:secretsmanager:us-east-1:398152419239:secret:ender-stack/dev/companion-openclaw-hello-bot-*',
    )
    // Log ARN scope on the exec inline policy — same exact-name
    // posture as the task role. The exec role additionally allows
    // logs:CreateLogGroup (the awslogs-create-group fallback path);
    // the resource list still references the literal group name,
    // not a `-*` suffix variant.
    const execLogStmt = execPolicy.Statement.find(
      (s) => s.Sid === 'AgentLogWrites',
    )
    expect(execLogStmt).toBeDefined()
    expect(execLogStmt!.Resource).toEqual([
      'arn:aws:logs:us-east-1:398152419239:log-group:/ecs/ender-stack-dev/companion-openclaw-hello-bot',
      'arn:aws:logs:us-east-1:398152419239:log-group:/ecs/ender-stack-dev/companion-openclaw-hello-bot:*',
    ])
  })

  it('grants only kms:Decrypt (not kms:DescribeKey) on the exec inline policy — matches the boundary scope', async () => {
    // The permissions boundary's BoundaryKMSDecryptForSecrets covers
    // kms:Decrypt exclusively. Granting DescribeKey here would
    // overstate effective permissions (boundary implicit-denies)
    // and confuse auditors comparing per-agent roles to the shared
    // exec role — which grants both as a historical posture.
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    await mintAgentRoles(baseInput())

    const putRolePolicyCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'PutRolePolicyCommand',
    )
    const execPolicy = JSON.parse(
      (
        putRolePolicyCalls[1][0] as {
          input: { PolicyDocument: string }
        }
      ).input.PolicyDocument,
    ) as {
      Statement: Array<{ Sid: string; Action: string | string[] }>
    }
    const kmsStmt = execPolicy.Statement.find(
      (s) => s.Sid === 'KMSDecryptSecrets',
    )
    expect(kmsStmt).toBeDefined()
    // Single action — assert both the string form AND the absence
    // of DescribeKey so a future "broaden to array of actions"
    // refactor fails this assertion explicitly.
    expect(kmsStmt!.Action).toBe('kms:Decrypt')
  })

  it('attaches AmazonECSTaskExecutionRolePolicy to the exec role only', async () => {
    primeMintHappy()
    const { mintAgentRoles, MANAGED_EXEC_POLICY_ARN } = await importModule()
    await mintAgentRoles(baseInput())

    const attachCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'AttachRolePolicyCommand',
    )
    expect(attachCalls).toHaveLength(1)
    const input = (
      attachCalls[0][0] as {
        input: { RoleName: string; PolicyArn: string }
      }
    ).input
    expect(input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
    expect(input.PolicyArn).toBe(MANAGED_EXEC_POLICY_ARN)
    expect(input.PolicyArn).toBe(
      'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    )
  })

  it('recovers from EntityAlreadyExists on CreateRole via GetRole fallback (idempotent retry)', async () => {
    // Mirror a retried create-agent after a prior partial-failure
    // that left the task role behind. CreateRole 4xxs with
    // EntityAlreadyExists; the helper falls through to GetRole.
    iamSendMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Role already exists'), {
          name: 'EntityAlreadyExistsException',
        }),
      )
      .mockResolvedValueOnce({ Role: { Arn: TASK_ROLE_ARN } }) // GetRole task
      .mockResolvedValueOnce({ Role: { Arn: EXEC_ROLE_ARN } }) // CreateRole exec OK
      .mockResolvedValueOnce({}) // PutRolePolicy task
      .mockResolvedValueOnce({}) // PutRolePolicy exec
      .mockResolvedValueOnce({}) // AttachRolePolicy exec
    const { mintAgentRoles } = await importModule()
    const result = await mintAgentRoles(baseInput())
    expect(result.taskRoleArn).toBe(TASK_ROLE_ARN)
    expect(result.executionRoleArn).toBe(EXEC_ROLE_ARN)
    // alreadyExisted=true: the caller's rollback path should be
    // skipped because we recovered the task role rather than
    // creating it. (See the corresponding agents-create test for the
    // outer-rollback-skipped assertion.)
    expect(result.alreadyExisted).toBe(true)
    // Verify the GetRole call was made.
    const getRoleCalls = iamSendMock.mock.calls.filter(
      (c) => (c[0] as { __type: string }).__type === 'GetRoleCommand',
    )
    expect(getRoleCalls).toHaveLength(1)
  })

  it('returns alreadyExisted=false when both roles are freshly created', async () => {
    primeMintHappy()
    const { mintAgentRoles } = await importModule()
    const result = await mintAgentRoles(baseInput())
    expect(result.alreadyExisted).toBe(false)
  })

  it('skips internal rollback when a role pre-existed (concurrent-create protection)', async () => {
    // Closes the round-5 Claude Auditor concurrency concern: B
    // hits EntityAlreadyExists on task (because A already created
    // it), then a downstream step fails. Without this guard, B's
    // rollback would delete the task role A's live service is
    // using.
    iamSendMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Role already exists'), {
          name: 'EntityAlreadyExistsException',
        }),
      )
      .mockResolvedValueOnce({ Role: { Arn: TASK_ROLE_ARN } }) // GetRole task — pre-existed
      .mockResolvedValueOnce({ Role: { Arn: EXEC_ROLE_ARN } }) // CreateRole exec OK (fresh)
      .mockRejectedValueOnce(
        Object.assign(new Error('quota'), {
          name: 'LimitExceededException',
        }),
      ) // PutRolePolicy task fails
    // Then NO rollback calls — verified below.
    const { mintAgentRoles } = await importModule()
    await expect(mintAgentRoles(baseInput())).rejects.toMatchObject({
      name: 'LimitExceededException',
    })
    // Assert NO DeleteRole / DetachRolePolicy calls fired (4 calls
    // total: CreateRole task + GetRole task + CreateRole exec +
    // PutRolePolicy task fail — and that's it).
    const commandTypes = iamSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(commandTypes).toEqual([
      'CreateRoleCommand', // task — EntityAlreadyExists
      'GetRoleCommand', // task recovery — alreadyExisted=true
      'CreateRoleCommand', // exec — fresh
      'PutRolePolicyCommand', // task — fails
    ])
    // No rollback commands appended.
    expect(commandTypes).not.toContain('DeleteRoleCommand')
    expect(commandTypes).not.toContain('DetachRolePolicyCommand')
  })

  it('propagates non-EntityAlreadyExists errors on CreateRole', async () => {
    iamSendMock.mockRejectedValueOnce(
      Object.assign(new Error('boundary not allowed'), {
        name: 'AccessDenied',
      }),
    )
    const { mintAgentRoles } = await importModule()
    await expect(mintAgentRoles(baseInput())).rejects.toMatchObject({
      name: 'AccessDenied',
    })
  })

  it('cleans up partial state when a step inside mintAgentRoles fails (atomic-on-failure)', async () => {
    // CreateRole task succeeds; CreateRole exec fails. Without
    // internal cleanup, the task role would orphan with no operator
    // signal (the outer agents.ts rollback only fires when the
    // success-path partial.iamTaskRoleArn was set, which only
    // happens AFTER mintAgentRoles returns).
    iamSendMock
      .mockResolvedValueOnce({ Role: { Arn: TASK_ROLE_ARN } }) // CreateRole task OK
      .mockRejectedValueOnce(
        Object.assign(new Error('quota'), { name: 'LimitExceededException' }),
      )
      // Cleanup: 5 calls in deleteAgentRoles, all resolve OK
      // (NoSuchEntity on the absent exec role/policies is suppressed).
      .mockResolvedValueOnce({}) // Detach exec — succeeds
      .mockResolvedValueOnce({}) // Delete inline task
      .mockRejectedValueOnce(
        Object.assign(new Error('absent'), { name: 'NoSuchEntity' }),
      ) // Delete inline exec (never created)
      .mockResolvedValueOnce({}) // Delete role task
      .mockRejectedValueOnce(
        Object.assign(new Error('absent'), { name: 'NoSuchEntity' }),
      ) // Delete role exec (never created)
    const { mintAgentRoles } = await importModule()
    await expect(mintAgentRoles(baseInput())).rejects.toMatchObject({
      name: 'LimitExceededException',
    })
    // Verify the cleanup chain fired (2 mint attempts + 5 teardown).
    const allCommandTypes = iamSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(allCommandTypes).toEqual([
      'CreateRoleCommand', // task — succeeded
      'CreateRoleCommand', // exec — threw
      'DetachRolePolicyCommand', // cleanup: detach exec managed policy
      'DeleteRolePolicyCommand', // cleanup: delete task inline
      'DeleteRolePolicyCommand', // cleanup: delete exec inline (NoSuchEntity)
      'DeleteRoleCommand', // cleanup: delete task role
      'DeleteRoleCommand', // cleanup: delete exec role (NoSuchEntity)
    ])
  })

  it('still re-throws the original mintErr when internal cleanup itself fails', async () => {
    iamSendMock
      .mockResolvedValueOnce({ Role: { Arn: TASK_ROLE_ARN } })
      .mockRejectedValueOnce(
        Object.assign(new Error('quota'), { name: 'LimitExceededException' }),
      )
      // Cleanup fails on the first call (e.g., transient throttle).
      .mockRejectedValueOnce(
        Object.assign(new Error('slow down'), { name: 'Throttling' }),
      )
    const { mintAgentRoles } = await importModule()
    // The original mintErr (LimitExceededException) surfaces — NOT
    // the cleanup-failure error. The caller's error path is what
    // needs the original signal.
    await expect(mintAgentRoles(baseInput())).rejects.toMatchObject({
      name: 'LimitExceededException',
    })
  })

  it('throws ConfigurationError when the computed role name exceeds 64 chars', async () => {
    // Non-standard cluster prefix would overflow AWS's 64-char
    // IAM role-name limit. Surface as a clean app-layer error
    // instead of a confusing AWS ValidationException 502.
    const { mintAgentRoles } = await importModule()
    await expect(
      mintAgentRoles({
        ...baseInput(),
        prefix: 'my-very-long-cluster-prefix-that-overflows', // 42 chars
        agentName: 'mediumname-12-chars', // would push past 64
      }),
    ).rejects.toMatchObject({ name: 'ConfigurationError' })
    // No IAM calls — fail-fast before CreateRole.
    expect(iamSendMock).not.toHaveBeenCalled()
  })
})

describe('deleteAgentRoles — invariants (#134)', () => {
  it('deletes in the load-bearing order: detach → delete-inline → delete-role', async () => {
    iamSendMock.mockResolvedValue({})
    const { deleteAgentRoles } = await importModule()
    await deleteAgentRoles({ agentName: 'hello-bot', prefix: 'ender-stack-dev' })

    const commandTypes = iamSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    // AWS rejects DeleteRole while any policy is attached, so this
    // ordering is a hard requirement.
    expect(commandTypes).toEqual([
      'DetachRolePolicyCommand',
      'DeleteRolePolicyCommand',
      'DeleteRolePolicyCommand',
      'DeleteRoleCommand',
      'DeleteRoleCommand',
    ])
  })

  it('targets the right role for each command', async () => {
    iamSendMock.mockResolvedValue({})
    const { deleteAgentRoles } = await importModule()
    await deleteAgentRoles({ agentName: 'hello-bot', prefix: 'ender-stack-dev' })

    const calls = iamSendMock.mock.calls.map(
      (c) =>
        (
          c[0] as {
            __type: string
            input: { RoleName?: string; PolicyArn?: string }
          }
        ),
    )
    // Detach: exec role only, managed ECS exec policy ARN.
    expect(calls[0].input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
    expect(calls[0].input.PolicyArn).toBe(
      'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    )
    // Delete inline: task then exec.
    expect(calls[1].input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-task',
    )
    expect(calls[2].input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
    // Delete roles: task then exec.
    expect(calls[3].input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-task',
    )
    expect(calls[4].input.RoleName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
  })

  it('suppresses NoSuchEntity at every step and reports them in alreadyDeleted', async () => {
    // Half-cleaned agent: every IAM resource already gone.
    const noSuchEntity = Object.assign(new Error('absent'), {
      name: 'NoSuchEntity',
    })
    iamSendMock.mockRejectedValue(noSuchEntity)

    const { deleteAgentRoles } = await importModule()
    const result = await deleteAgentRoles({
      agentName: 'hello-bot',
      prefix: 'ender-stack-dev',
    })
    expect(result.ok).toBe(true)
    expect(result.alreadyDeleted.length).toBeGreaterThanOrEqual(5)
    // Both role names + both inline-policy markers + the managed-policy
    // marker on the exec role should all appear.
    expect(result.alreadyDeleted).toContain(
      'ender-stack-dev-companion-openclaw-hello-bot-task',
    )
    expect(result.alreadyDeleted).toContain(
      'ender-stack-dev-companion-openclaw-hello-bot-exec',
    )
  })

  it('also suppresses the SDK-suffixed NoSuchEntityException variant', async () => {
    const noSuchEntity = Object.assign(new Error('absent'), {
      name: 'NoSuchEntityException',
    })
    iamSendMock.mockRejectedValue(noSuchEntity)
    const { deleteAgentRoles } = await importModule()
    const result = await deleteAgentRoles({
      agentName: 'hello-bot',
      prefix: 'ender-stack-dev',
    })
    expect(result.ok).toBe(true)
  })

  it('propagates non-NoSuchEntity errors (e.g., access denied)', async () => {
    const accessDenied = Object.assign(new Error('forbidden'), {
      name: 'AccessDenied',
    })
    iamSendMock.mockRejectedValue(accessDenied)
    const { deleteAgentRoles } = await importModule()
    await expect(
      deleteAgentRoles({ agentName: 'hello-bot', prefix: 'ender-stack-dev' }),
    ).rejects.toMatchObject({ name: 'AccessDenied' })
  })
})

describe('roleNames helper', () => {
  it('builds the {prefix}-companion-openclaw-{agent}-{task,exec} pair', async () => {
    const { roleNames } = await importModule()
    expect(roleNames('ender-stack-dev', 'hello-bot')).toEqual({
      taskRoleName: 'ender-stack-dev-companion-openclaw-hello-bot-task',
      executionRoleName: 'ender-stack-dev-companion-openclaw-hello-bot-exec',
    })
  })
})
