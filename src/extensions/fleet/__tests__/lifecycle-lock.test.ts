import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const ssmSendMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()

// Each Command constructor wraps its input in a __type-tagged object so
// tests can assert what the lib asked SSM for (Overwrite flag etc.).
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({ send: ssmSendMock })),
  PutParameterCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutParameterCommand',
    input,
  })),
  GetParameterCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'GetParameterCommand',
    input,
  })),
  DeleteParameterCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteParameterCommand',
    input,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: loggerWarnMock, info: vi.fn() },
}))

const importLock = async () => import('../lib/lifecycle-lock')

const awsError = (name: string) =>
  Object.assign(new Error(name), { name })

const cmdTypes = () =>
  ssmSendMock.mock.calls.map((c) => (c[0] as { __type: string }).__type)

const cmdInputs = () =>
  ssmSendMock.mock.calls.map((c) => (c[0] as { input: unknown }).input)

const baseInput = {
  projectName: 'ender-stack',
  environment: 'dev',
  agentName: 'hello-bot',
}

beforeEach(() => {
  ssmSendMock.mockReset()
  loggerWarnMock.mockReset()
  loggerErrorMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('lifecycleLockParamName', () => {
  it('builds the per-agent lock path under companion-openclaw', async () => {
    const { lifecycleLockParamName } = await importLock()
    expect(lifecycleLockParamName('ender-stack', 'dev', 'hello-bot')).toBe(
      '/ender-stack/dev/companion-openclaw/hello-bot/lifecycle-lock',
    )
  })
})

describe('acquireLifecycleLock', () => {
  it('acquires with an atomic Overwrite:false PutParameter when no lock exists', async () => {
    ssmSendMock.mockResolvedValueOnce({ Version: 1 }) // PutParameter OK
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create', actor: 7 })

    expect(res).toEqual({ ok: true, token: expect.any(String) })
    expect(cmdTypes()).toEqual(['PutParameterCommand'])
    const put = cmdInputs()[0] as { Name: string; Overwrite: boolean; Type: string; Value: string }
    expect(put.Overwrite).toBe(false)
    expect(put.Type).toBe('String')
    expect(put.Name).toBe('/ender-stack/dev/companion-openclaw/hello-bot/lifecycle-lock')
    // The fencing token written into the value matches the returned token.
    expect((res as { token: string }).token).toBe(JSON.parse(put.Value).token)
  })

  it('returns held when a FRESH lock exists (contention → caller 409)', async () => {
    const fresh = { op: 'delete', actor: 3, ts: Date.now() - 1000 } // 1s old
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists')) // acquire blocked
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fresh) } }) // GetParameter
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    expect(res).toEqual({ ok: false, reason: 'held', heldBy: fresh })
    expect(cmdTypes()).toEqual(['PutParameterCommand', 'GetParameterCommand'])
  })

  it('reclaims a STALE lock (older than TTL) via Overwrite:true', async () => {
    const { acquireLifecycleLock, LIFECYCLE_LOCK_TTL_MS } = await importLock()
    const stale = {
      op: 'create',
      actor: 9,
      ts: Date.now() - LIFECYCLE_LOCK_TTL_MS - 1000, // older than TTL
    }
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists')) // acquire blocked
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(stale) } }) // GetParameter
      .mockResolvedValueOnce({ Version: 2 }) // reclaim PutParameter(Overwrite:true)

    const res = await acquireLifecycleLock({ ...baseInput, op: 'delete' })

    expect(res).toEqual({ ok: true, token: expect.any(String) })
    expect(cmdTypes()).toEqual([
      'PutParameterCommand',
      'GetParameterCommand',
      'PutParameterCommand',
    ])
    const reclaim = cmdInputs()[2] as { Overwrite: boolean }
    expect(reclaim.Overwrite).toBe(true)
    expect(loggerWarnMock).toHaveBeenCalled() // stale-reclaim is logged
  })

  it('RETRIES the atomic acquire (not an overwrite) when the lock vanished between acquire and read', async () => {
    // #85 P1 "vanished lock clobbers holder": a NotFound on the staleness
    // read means the slot is now free, so we re-attempt Overwrite:false
    // — never Overwrite:true, which would clobber a holder that acquired
    // in the gap.
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists')) // acquire blocked
      .mockRejectedValueOnce(awsError('ParameterNotFound')) // GetParameter — vanished
      .mockResolvedValueOnce({ Version: 3 }) // retry: PutParameter(Overwrite:false)
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    expect(res).toEqual({ ok: true, token: expect.any(String) })
    expect(cmdTypes()).toEqual([
      'PutParameterCommand',
      'GetParameterCommand',
      'PutParameterCommand',
    ])
    // The retry is an ATOMIC acquire, not a clobbering overwrite.
    const retry = cmdInputs()[2] as { Overwrite: boolean }
    expect(retry.Overwrite).toBe(false)
  })

  it('fails closed when the vanished-retry budget is exhausted under contention', async () => {
    // Every attempt: acquire blocked → read vanished → retry. After
    // MAX_ACQUIRE_ATTEMPTS the loop gives up rather than spin forever.
    ssmSendMock.mockImplementation((cmd: { __type: string }) => {
      if (cmd.__type === 'PutParameterCommand') {
        return Promise.reject(awsError('ParameterAlreadyExists'))
      }
      return Promise.reject(awsError('ParameterNotFound')) // GetParameter
    })
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    expect(res).toEqual({ ok: false, reason: 'error', errorName: 'LockAcquireContention' })
  })

  it('treats an unparseable lock value as stale and reclaims it', async () => {
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists'))
      .mockResolvedValueOnce({ Parameter: { Value: 'not-json{' } }) // corrupt
      .mockResolvedValueOnce({ Version: 4 })
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'delete' })

    expect(res).toEqual({ ok: true, token: expect.any(String) })
  })

  it('treats a valid-JSON lock with an out-of-union op as stale (parseHolder narrows op)', async () => {
    // A tampered/corrupt value with op:"arbitrary" must NOT be honored as
    // a held lock — otherwise it would surface verbatim in the 409 detail.
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists'))
      .mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify({ op: 'arbitrary', ts: Date.now() }) },
      })
      .mockResolvedValueOnce({ Version: 5 }) // reclaim
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    // Not returned as 'held' — parseHolder rejects the bad op → reclaimed.
    expect(res).toEqual({ ok: true, token: expect.any(String) })
  })

  it('fails closed (reason=error) on a non-contention SSM error during acquire', async () => {
    ssmSendMock.mockRejectedValueOnce(awsError('ThrottlingException'))
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    expect(res).toEqual({ ok: false, reason: 'error', errorName: 'ThrottlingException' })
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('fails closed when the staleness read itself errors', async () => {
    ssmSendMock
      .mockRejectedValueOnce(awsError('ParameterAlreadyExists'))
      .mockRejectedValueOnce(awsError('AccessDeniedException')) // GetParameter errors
    const { acquireLifecycleLock } = await importLock()

    const res = await acquireLifecycleLock({ ...baseInput, op: 'create' })

    expect(res).toEqual({ ok: false, reason: 'error', errorName: 'AccessDeniedException' })
  })
})

describe('releaseLifecycleLock', () => {
  it('deletes the lock parameter unconditionally when no token is supplied', async () => {
    ssmSendMock.mockResolvedValueOnce({})
    const { releaseLifecycleLock } = await importLock()

    await releaseLifecycleLock(baseInput)

    expect(cmdTypes()).toEqual(['DeleteParameterCommand'])
    const del = cmdInputs()[0] as { Name: string }
    expect(del.Name).toBe('/ender-stack/dev/companion-openclaw/hello-bot/lifecycle-lock')
  })

  it('deletes the lock when the stored fencing token matches (we still own it)', async () => {
    ssmSendMock
      .mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify({ op: 'create', ts: Date.now(), token: 'tok-A' }) },
      }) // ownership read — our token
      .mockResolvedValueOnce({}) // DeleteParameter
    const { releaseLifecycleLock } = await importLock()

    await releaseLifecycleLock({ ...baseInput, token: 'tok-A' })

    expect(cmdTypes()).toEqual(['GetParameterCommand', 'DeleteParameterCommand'])
  })

  it('does NOT delete when the stored token differs — a newer op reclaimed the lock (#85 P1)', async () => {
    ssmSendMock.mockResolvedValueOnce({
      Parameter: { Value: JSON.stringify({ op: 'delete', ts: Date.now(), token: 'tok-SUCCESSOR' }) },
    }) // ownership read — someone else's token
    const { releaseLifecycleLock } = await importLock()

    await releaseLifecycleLock({ ...baseInput, token: 'tok-A' })

    // Get only — the successor's lock is left intact.
    expect(cmdTypes()).toEqual(['GetParameterCommand'])
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  it('does NOT delete when the ownership read errors — leaves the lock to self-expire (avoids clobber)', async () => {
    ssmSendMock.mockRejectedValueOnce(awsError('ThrottlingException')) // ownership read fails
    const { releaseLifecycleLock } = await importLock()

    await releaseLifecycleLock({ ...baseInput, token: 'tok-A' })

    expect(cmdTypes()).toEqual(['GetParameterCommand']) // no Delete attempted
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('is idempotent — ParameterNotFound is swallowed (already released)', async () => {
    ssmSendMock.mockRejectedValueOnce(awsError('ParameterNotFound'))
    const { releaseLifecycleLock } = await importLock()

    await expect(releaseLifecycleLock(baseInput)).resolves.toBeUndefined()
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('never throws on a release error — logs and degrades to TTL self-expiry', async () => {
    ssmSendMock.mockRejectedValueOnce(awsError('ThrottlingException'))
    const { releaseLifecycleLock } = await importLock()

    await expect(releaseLifecycleLock(baseInput)).resolves.toBeUndefined()
    expect(loggerErrorMock).toHaveBeenCalled()
  })
})
