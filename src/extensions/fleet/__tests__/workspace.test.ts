import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── AWS ECS (agent-existence two-tag guard) ──
const ecsSendMock = vi.fn()
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
}))

// ── node:fs/promises (the EFS persona-file I/O) ──
const readFileMock = vi.fn()
const renameMock = vi.fn()
const openMock = vi.fn()
const readdirMock = vi.fn()
const unlinkMock = vi.fn()
const statMock = vi.fn()
vi.mock('node:fs/promises', () => {
  const api = {
    readFile: (...a: unknown[]) => readFileMock(...a),
    rename: (...a: unknown[]) => renameMock(...a),
    open: (...a: unknown[]) => openMock(...a),
    readdir: (...a: unknown[]) => readdirMock(...a),
    unlink: (...a: unknown[]) => unlinkMock(...a),
    stat: (...a: unknown[]) => statMock(...a),
  }
  return { ...api, default: api }
})

const loggerErrorMock = vi.fn()
const loggerWarnMock = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: loggerWarnMock, info: vi.fn() },
}))

const requireRoleMock = vi.fn((): any => ({
  user: { id: 1, username: 'admin', role: 'admin' },
}))
vi.mock('@/lib/auth', () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...(a as [])),
}))

const logAuditEventMock = vi.fn()
vi.mock('@/lib/db', () => ({
  logAuditEvent: (...a: unknown[]) => logAuditEventMock(...a),
}))

const mutationLimiterMock = vi.fn((_req: unknown) => null as unknown)
vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: (req: unknown) => mutationLimiterMock(req),
}))

const importHandlers = async () => {
  const mod = await import('../api/workspace')
  return { GET: mod.GET, PUT: mod.PUT }
}

const AGENT = 'hello-bot'
const SERVICE_ARN = `arn:aws:ecs:us-east-1:398152419239:service/ender-stack-dev/ender-stack-dev-companion-openclaw-${AGENT}`

const setRequiredEnv = () => {
  process.env.AWS_REGION = 'us-east-1'
  process.env.MC_FLEET_CLUSTER_NAME = 'ender-stack-dev'
  process.env.MC_FLEET_PROJECT_NAME = 'ender-stack'
  process.env.MC_FLEET_ENVIRONMENT = 'dev'
  process.env.MC_AGENT_WORKSPACE_ROOT = '/companion/openclaw'
}

type AnyReq = Parameters<Awaited<ReturnType<typeof importHandlers>>['GET']>[0]

const mkGetRequest = (): AnyReq =>
  ({
    url: `http://localhost/api/fleet/agents/${AGENT}/workspace/USER.md`,
    headers: new Headers(),
  }) as unknown as AnyReq

const mkPutRequest = (
  body: unknown,
  headers: Record<string, string> = {},
): AnyReq =>
  ({
    url: `http://localhost/api/fleet/agents/${AGENT}/workspace/USER.md`,
    headers: new Headers(headers),
    json: async () => body,
  }) as unknown as AnyReq

const mkParams = (name = AGENT, filename = 'USER.md') => ({
  params: Promise.resolve({ name, filename }),
})

const primeHarness = () =>
  ecsSendMock.mockResolvedValueOnce({
    services: [
      {
        serviceArn: SERVICE_ARN,
        status: 'ACTIVE',
        taskDefinition: 'arn:aws:ecs:us-east-1:398152419239:task-definition/x:7',
        tags: [
          { key: 'Component', value: 'agent-harness' },
          { key: 'ManagedBy', value: 'mission-control' },
        ],
      },
    ],
  })

/** Wire the fs mocks for a successful atomic write. */
const fhMock = {
  writeFile: vi.fn().mockResolvedValue(undefined),
  sync: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}
const primeWriteFs = (current: string) => {
  readFileMock.mockResolvedValueOnce(current) // read-before-write
  readdirMock.mockResolvedValueOnce([]) // no stale temp files
  openMock.mockResolvedValue(fhMock) // temp-file write + parent-dir fsync
  renameMock.mockResolvedValueOnce(undefined)
}

// sha256("hello") for the optimistic-concurrency tests.
const HELLO = 'hello'

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
  readFileMock.mockReset()
  renameMock.mockReset()
  openMock.mockReset()
  readdirMock.mockReset()
  unlinkMock.mockReset()
  unlinkMock.mockResolvedValue(undefined)
  statMock.mockReset()
  statMock.mockResolvedValue({ size: 100 }) // small by default; one test overrides
  fhMock.writeFile.mockClear()
  fhMock.sync.mockClear()
  fhMock.close.mockClear()
  logAuditEventMock.mockReset()
  loggerErrorMock.mockReset()
  loggerWarnMock.mockReset()
  mutationLimiterMock.mockReset()
  mutationLimiterMock.mockReturnValue(null as unknown)
  requireRoleMock.mockReturnValue({
    user: { id: 1, username: 'admin', role: 'admin' },
  })
})

describe('GET /api/fleet/agents/:name/workspace/:filename', () => {
  it('admin reads a persona file and gets its content + hash', async () => {
    primeHarness()
    readFileMock.mockResolvedValueOnce('# USER\n\nhi')
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.ok).toBe(true)
    expect(body.filename).toBe('USER.md')
    expect(body.content).toBe('# USER\n\nhi')
    expect(typeof body.hash).toBe('string')
    expect(body.hash).toHaveLength(64) // sha256 hex
  })

  it('rejects a non-admin caller with 403', async () => {
    requireRoleMock.mockReturnValue({
      error: 'Requires admin role or higher',
      status: 403,
    })
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(403)
  })

  it('rejects an invalid agent name with 400', async () => {
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams('Bad_Name!'))
    expect(resp.status).toBe(400)
    expect((await resp.json()).error).toBe('InvalidAgentName')
  })

  it('rejects a filename outside the allow-list with 400 (no fs/ECS touched)', async () => {
    const { GET } = await importHandlers()
    for (const bad of ['openclaw.json', '../config/openclaw.json', '.env', 'TOOLS.md']) {
      const resp = await GET(mkGetRequest(), mkParams(AGENT, bad))
      expect(resp.status).toBe(400)
      expect((await resp.json()).error).toBe('InvalidFilename')
    }
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns 404 for a service that is not an MC-managed agent', async () => {
    ecsSendMock.mockResolvedValueOnce({
      services: [],
      failures: [{ arn: SERVICE_ARN, reason: 'MISSING' }],
    })
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(404)
  })

  it('returns 404 when the seeded file is absent (ENOENT)', async () => {
    primeHarness()
    readFileMock.mockRejectedValueOnce({ code: 'ENOENT' })
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect((await resp.json()).error).toBe('FileNotFound')
  })

  it('returns 413 when the on-disk file exceeds the size cap (no full read)', async () => {
    primeHarness()
    statMock.mockResolvedValueOnce({ size: 1024 * 1024 + 1 })
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(413)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('returns 500 when MC_AGENT_WORKSPACE_ROOT is unset', async () => {
    delete process.env.MC_AGENT_WORKSPACE_ROOT
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams())
    expect(resp.status).toBe(500)
    expect((await resp.json()).error).toBe('ConfigurationError')
  })
})

describe('PUT /api/fleet/agents/:name/workspace/:filename', () => {
  it('admin write performs an atomic temp-then-rename and audits with both hashes', async () => {
    primeHarness()
    primeWriteFs(HELLO)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: '# USER\nnew', expected_hash: expectedHash }),
      mkParams(),
    )
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.ok).toBe(true)
    expect(body.hash).toHaveLength(64)

    // Atomic write: O_EXCL temp open, rename onto target, then parent-dir fsync.
    expect(openMock).toHaveBeenCalledTimes(2)
    const [tmpPath, flag] = openMock.mock.calls[0]
    expect(flag).toBe('wx')
    expect(String(tmpPath)).toMatch(/\/companion\/openclaw\/hello-bot\/workspace\/\.USER\.md\..*\.tmp$/)
    // Second open is the parent dir, opened read-only for fsync durability.
    expect(openMock.mock.calls[1]).toEqual(['/companion/openclaw/hello-bot/workspace', 'r'])
    expect(fhMock.sync).toHaveBeenCalledTimes(2) // temp file + parent dir
    expect(renameMock).toHaveBeenCalledTimes(1)
    expect(renameMock.mock.calls[0][0]).toBe(tmpPath)
    expect(renameMock.mock.calls[0][1]).toBe('/companion/openclaw/hello-bot/workspace/USER.md')

    // Audit: action + both hashes recorded.
    expect(logAuditEventMock).toHaveBeenCalledTimes(1)
    const audit = logAuditEventMock.mock.calls[0][0]
    expect(audit.action).toBe('agent_persona_write')
    expect(audit.detail.file).toBe('USER.md')
    expect(audit.detail.hashBefore).toBe(expectedHash)
    expect(audit.detail.hashAfter).toBe(body.hash)
  })

  it('requires a precondition (If-Match / expected_hash) → 428', async () => {
    primeHarness()
    readFileMock.mockResolvedValueOnce(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(mkPutRequest({ content: 'x' }), mkParams())
    expect(resp.status).toBe(428)
    expect((await resp.json()).error).toBe('PreconditionRequired')
    expect(renameMock).not.toHaveBeenCalled()
  })

  it('accepts the precondition via the If-Match header', async () => {
    primeHarness()
    primeWriteFs(HELLO)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'updated' }, { 'If-Match': expectedHash }),
      mkParams(),
    )
    expect(resp.status).toBe(200)
    expect(renameMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a quoted If-Match entity-tag (strips quotes / weak validator)', async () => {
    primeHarness()
    primeWriteFs(HELLO)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'updated' }, { 'If-Match': `W/"${expectedHash}"` }),
      mkParams(),
    )
    expect(resp.status).toBe(200)
    expect(renameMock).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent writers: one 200, one 409 (no lost update)', async () => {
    // Both requests carry the same expectedHash (the base content). The mutex
    // forces them through the critical section one at a time: the first wins
    // (reads base → writes), the second then reads the just-written content,
    // sees a hash mismatch, and gets 409 instead of silently clobbering.
    ecsSendMock.mockResolvedValue({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          taskDefinition: 'arn:x:7',
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'mission-control' },
          ],
        },
      ],
    })
    readFileMock
      .mockResolvedValueOnce(HELLO) // first writer reads base
      .mockResolvedValueOnce('first-writer-content') // second writer reads new
    readdirMock.mockResolvedValue([])
    openMock.mockResolvedValue(fhMock)
    renameMock.mockResolvedValue(undefined)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const [r1, r2] = await Promise.all([
      PUT(mkPutRequest({ content: 'a', expected_hash: expectedHash }), mkParams()),
      PUT(mkPutRequest({ content: 'b', expected_hash: expectedHash }), mkParams()),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(renameMock).toHaveBeenCalledTimes(1) // only the winner wrote
  })

  it('returns 409 with the current hash when the file changed since GET', async () => {
    primeHarness()
    readFileMock.mockResolvedValueOnce('the agent rewrote this')
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'x', expected_hash: 'stale-hash' }),
      mkParams(),
    )
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.error).toBe('Conflict')
    expect(body.hash).toHaveLength(64) // current server hash for refetch
    expect(renameMock).not.toHaveBeenCalled()
  })

  it('returns 429 when the mutation rate limiter trips (before any fs/ECS work)', async () => {
    mutationLimiterMock.mockReturnValue(
      new Response(JSON.stringify({ error: 'RateLimited' }), { status: 429 }),
    )
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'x', expected_hash: 'h' }),
      mkParams(),
    )
    expect(resp.status).toBe(429)
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized payload with 413', async () => {
    primeHarness()
    const { PUT } = await importHandlers()
    const huge = 'a'.repeat(1024 * 1024 + 1)
    const resp = await PUT(
      mkPutRequest({ content: huge, expected_hash: 'h' }),
      mkParams(),
    )
    expect(resp.status).toBe(413)
    expect(renameMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed body with 400', async () => {
    primeHarness()
    const { PUT } = await importHandlers()
    const resp = await PUT(mkPutRequest({ notContent: 1 }), mkParams())
    expect(resp.status).toBe(400)
    expect((await resp.json()).error).toBe('InvalidRequestShape')
  })

  it('admin can write SOUL.md (admin row of the write matrix covers all four)', async () => {
    primeHarness()
    primeWriteFs(HELLO)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'soul', expected_hash: expectedHash }),
      mkParams(AGENT, 'SOUL.md'),
    )
    expect(resp.status).toBe(200)
  })
})

// These pin the §3 matrix contract for the future Owner tier. requireRole is
// mocked so the min-role gate is bypassed — we exercise the matrix directly by
// presenting an `owner` role. When the real ownership primitive lands, the
// matrix (not the gate) is what enforces these outcomes, unchanged.
describe('§3 permission matrix contract (Owner tier, forward-looking)', () => {
  const asOwner = () =>
    requireRoleMock.mockReturnValue({
      user: { id: 2, username: 'owner-user', role: 'owner' },
    })

  it('owner may READ SOUL.md (read matrix grants all four)', async () => {
    asOwner()
    primeHarness()
    readFileMock.mockResolvedValueOnce('soul')
    const { GET } = await importHandlers()
    const resp = await GET(mkGetRequest(), mkParams(AGENT, 'SOUL.md'))
    expect(resp.status).toBe(200)
  })

  it('owner may NOT WRITE SOUL.md (write matrix is IDENTITY/USER only) → 403', async () => {
    asOwner()
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'x', expected_hash: 'h' }),
      mkParams(AGENT, 'SOUL.md'),
    )
    expect(resp.status).toBe(403)
    expect((await resp.json()).error).toBe('Forbidden')
    // Matrix denies before any ECS/fs work.
    expect(ecsSendMock).not.toHaveBeenCalled()
  })

  it('owner may WRITE USER.md (write matrix grants it)', async () => {
    asOwner()
    primeHarness()
    primeWriteFs(HELLO)
    const expectedHash = (await importCryptoHash())(HELLO)
    const { PUT } = await importHandlers()
    const resp = await PUT(
      mkPutRequest({ content: 'mine', expected_hash: expectedHash }),
      mkParams(AGENT, 'USER.md'),
    )
    expect(resp.status).toBe(200)
  })
})

// Small helper: the real sha256 the handler uses, so concurrency tests echo a
// matching hash without hardcoding digests.
async function importCryptoHash() {
  const { createHash } = await import('node:crypto')
  return (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')
}
