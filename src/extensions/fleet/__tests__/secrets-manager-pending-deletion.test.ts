import { describe, expect, it, vi, beforeEach } from 'vitest'

const smSendMock = vi.fn()

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi
    .fn()
    .mockImplementation(() => ({ send: smSendMock })),
  CreateSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'CreateSecretCommand',
    input,
  })),
  PutSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutSecretValueCommand',
    input,
  })),
  GetSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'GetSecretValueCommand',
    input,
  })),
  DeleteSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteSecretCommand',
    input,
  })),
  RestoreSecretCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'RestoreSecretCommand',
    input,
  })),
}))

const pendingDeletionError = (path: 'put' | 'create') =>
  Object.assign(
    new Error(
      path === 'put'
        ? "You can't perform this operation on the secret because it was marked for deletion."
        : 'Cannot create secret with name … because it is scheduled for deletion. Restore the secret then call CreateSecret again.',
    ),
    { name: 'InvalidRequestException' },
  )

const importPutOrCreate = async () => {
  process.env.MC_AGENT_SECRETS_NAME_PREFIX = 'ender-stack/dev/companion-openclaw'
  const mod = await import('../lib/secrets-manager')
  return mod.putOrCreateSecret
}

beforeEach(() => {
  smSendMock.mockReset()
})

describe('putOrCreateSecret — PendingDeletion recovery (#354)', () => {
  it('restores the secret and retries when PutSecretValue hits PendingDeletion', async () => {
    smSendMock
      .mockRejectedValueOnce(pendingDeletionError('put')) // Put on pending-deletion → throws
      .mockResolvedValueOnce({}) // RestoreSecret → OK
      .mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:test:1' }) // Put retry → OK
    const putOrCreate = await importPutOrCreate()
    const out = await putOrCreate({
      name: 'ender-stack/dev/companion-openclaw-foo-litellm-key',
      value: 'sk-virtual',
      description: 'test',
      tags: [],
    })
    expect(out).toEqual({
      arn: 'arn:aws:secretsmanager:test:1',
      operation: 'updated',
    })
    const calls = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(calls).toEqual([
      'PutSecretValueCommand',
      'RestoreSecretCommand',
      'PutSecretValueCommand',
    ])
  })

  it('restores when CreateSecret hits PendingDeletion after a NotFound on Put', async () => {
    smSendMock
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      ) // Put → NotFound → fall through to Create
      .mockRejectedValueOnce(pendingDeletionError('create')) // Create → PendingDeletion
      .mockResolvedValueOnce({}) // RestoreSecret → OK
      .mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:test:2' }) // recursion: Put → OK
    const putOrCreate = await importPutOrCreate()
    const out = await putOrCreate({
      name: 'ender-stack/dev/companion-openclaw-bar-litellm-key',
      value: 'sk-virtual',
      description: 'test',
      tags: [],
    })
    expect(out.operation).toBe('updated')
    const calls = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(calls).toEqual([
      'PutSecretValueCommand',
      'CreateSecretCommand',
      'RestoreSecretCommand',
      'PutSecretValueCommand',
    ])
  })

  it('does NOT swallow InvalidRequestException with an unrelated message', async () => {
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('Some other validation issue'), {
        name: 'InvalidRequestException',
      }),
    )
    const putOrCreate = await importPutOrCreate()
    await expect(
      putOrCreate({
        name: 'ender-stack/dev/companion-openclaw-baz-litellm-key',
        value: 'sk-virtual',
        description: 'test',
        tags: [],
      }),
    ).rejects.toMatchObject({
      name: 'InvalidRequestException',
    })
    // RestoreSecret must NOT have been called.
    const calls = smSendMock.mock.calls.map(
      (c) => (c[0] as { __type: string }).__type,
    )
    expect(calls).toEqual(['PutSecretValueCommand'])
  })
})

describe('deleteAgentLiteLLMKey — PendingDeletion idempotency (#354 round-2)', () => {
  const importDelete = async () => {
    process.env.MC_AGENT_SECRETS_NAME_PREFIX =
      'ender-stack/dev/companion-openclaw'
    const mod = await import('../lib/secrets-manager')
    return mod.deleteAgentLiteLLMKey
  }

  it('returns alreadyDeleted=true when SM returns InvalidRequestException for already-pending-deletion', async () => {
    // SM returns InvalidRequestException on a second DeleteSecret
    // call for an already-scheduled secret (Greptile P2). The
    // handler must treat that as idempotent so retry-of-DELETE
    // doesn't surface a spurious failure warning.
    smSendMock.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'You can\'t perform this operation on the secret because it was marked for deletion.',
        ),
        { name: 'InvalidRequestException' },
      ),
    )
    const deleteKey = await importDelete()
    const out = await deleteKey('foo')
    expect(out.alreadyDeleted).toBe(true)
    expect(out.secretName).toBe(
      'ender-stack/dev/companion-openclaw-foo-litellm-key',
    )
  })

  it('returns alreadyDeleted=true (with secretName) on ResourceNotFoundException', async () => {
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    const deleteKey = await importDelete()
    const out = await deleteKey('bar')
    expect(out.alreadyDeleted).toBe(true)
    expect(out.secretName).toBe(
      'ender-stack/dev/companion-openclaw-bar-litellm-key',
    )
  })

  it('returns alreadyDeleted=false (+ secretName) on a clean delete', async () => {
    smSendMock.mockResolvedValueOnce({})
    const deleteKey = await importDelete()
    const out = await deleteKey('baz')
    expect(out.alreadyDeleted).toBe(false)
    expect(out.secretName).toBe(
      'ender-stack/dev/companion-openclaw-baz-litellm-key',
    )
  })

  it('propagates non-PendingDeletion InvalidRequestException', async () => {
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('unrelated'), { name: 'InvalidRequestException' }),
    )
    const deleteKey = await importDelete()
    await expect(deleteKey('quux')).rejects.toMatchObject({
      name: 'InvalidRequestException',
    })
  })
})

describe('putOrCreateSecret — PendingDeletion recursion depth guard (#354 round-3)', () => {
  it('refuses to recurse past depth 1 if SM keeps returning PendingDeletion after RestoreSecret', async () => {
    // Pathological case: every Put returns PendingDeletion, and
    // RestoreSecret keeps "succeeding" without flipping the state.
    // Without the depth guard this would stack-overflow.
    smSendMock
      .mockRejectedValueOnce(pendingDeletionError('put')) // depth 0: Put → pending
      .mockResolvedValueOnce({}) // RestoreSecret
      .mockRejectedValueOnce(pendingDeletionError('put')) // depth 1: Put → pending
      .mockResolvedValueOnce({}) // RestoreSecret
      // Test would attempt depth 2 here — but the guard throws first.
    const putOrCreate = await importPutOrCreate()
    await expect(
      putOrCreate({
        name: 'ender-stack/dev/companion-openclaw-loop-litellm-key',
        value: 'sk-virtual',
        description: 'test',
        tags: [],
      }),
    ).rejects.toMatchObject({
      name: 'PutOrCreatePendingDeletionRetryExhausted',
    })
  })
})
