import { describe, expect, it, vi, beforeEach } from 'vitest'

const ecsSendMock = vi.fn()
const smSendMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
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
  GetSecretValueCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'GetSecretValueCommand',
    input,
  })),
}))

const loggerErrorMock = vi.fn()
const loggerWarnMock = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: loggerWarnMock, info: vi.fn() },
}))

const requireRoleMock = vi.fn(() => ({ user: { id: 'test', role: 'admin' } }))
vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

const logSecurityEventMock = vi.fn()
vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: logSecurityEventMock,
}))

const importHandler = async () => {
  const mod = await import('../api/slack-channels')
  return mod.GET
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
const BOT_TOKEN = 'xoxb-test-token-NEVER-LOG-THIS'

const mkRequest = () =>
  ({
    url: `http://localhost/api/fleet/agents/${AGENT}/slack/channels`,
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
        tags: [
          { key: 'Component', value: 'agent-harness' },
          { key: 'ManagedBy', value: 'mission-control' },
        ],
      },
    ],
  })

const slackOk = (channels: unknown[], nextCursor = '') => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({
    ok: true,
    channels,
    response_metadata: { next_cursor: nextCursor },
  }),
})

// Slack returns errors as HTTP-200 + `{ ok: false, error: "..." }`
// for the application-level cases (invalid_auth, missing_scope,
// account_inactive, etc.). HTTP-non-200 is reserved for transport-
// level failures (429 rate limit, 5xx outages).
//
// Round-3 audit on PR #49: this helper's `status` parameter only
// affects the `ok` field used by `if (!resp.ok)` in slack-client.ts.
// Passing `status >= 300` makes the wrapper short-circuit to
// SlackNetworkError BEFORE the body is parsed — so the `code`
// argument has no effect on the test outcome. Keep
// `slackErr('invalid_auth', 200)` for application errors; use the
// inline `{ status: 503, ... }` mock shape for transport errors.
const slackErr = (code: string, status = 200) => ({
  ok: status === 200,
  status,
  headers: new Headers(),
  json: async () => ({ ok: false, error: code }),
})

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
  smSendMock.mockReset()
  fetchMock.mockReset()
  logSecurityEventMock.mockReset()
  loggerErrorMock.mockReset()
  loggerWarnMock.mockReset()
  // Reset auth mock to the default authenticated-admin shape;
  // individual tests override for 401/403 assertions.
  requireRoleMock.mockReturnValue({ user: { id: 'test', role: 'admin' } })
  vi.stubGlobal('fetch', fetchMock)
})

describe('GET /api/fleet/agents/:name/slack/channels — happy path', () => {
  it('returns channels list with normalized field shape', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(
      slackOk([
        { id: 'C012ABCDEF', name: 'general', is_private: false, num_members: 42 },
        { id: 'G987654321', name: 'private-team', is_private: true, num_members: 5 },
      ]),
    )

    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      ok: boolean
      agentName: string
      channels: Array<{ id: string; name: string; isPrivate: boolean; numMembers?: number }>
      truncated: boolean
    }
    expect(json.ok).toBe(true)
    expect(json.agentName).toBe(AGENT)
    expect(json.truncated).toBe(false)
    expect(json.channels).toEqual([
      { id: 'C012ABCDEF', name: 'general', isPrivate: false, numMembers: 42 },
      { id: 'G987654321', name: 'private-team', isPrivate: true, numMembers: 5 },
    ])
  })

  it('marks truncated=true when Slack returns a non-empty next_cursor', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(
      slackOk([{ id: 'C0123456789', name: 'general', is_private: false }], 'cursor-abc'),
    )

    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as { truncated: boolean }
    expect(json.truncated).toBe(true)
  })

  it('passes the bot token as Bearer auth on the Slack call', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackOk([]))

    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/slack\.com\/api\/conversations\.list\?/)
    expect(String(url)).toContain('limit=100')
    expect(String(url)).toContain('types=public_channel%2Cprivate_channel')
    expect(String(url)).toContain('exclude_archived=true')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${BOT_TOKEN}`,
    })
  })

  it('emits a security event with channel count + truncated flag, never the token', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(
      slackOk([
        { id: 'C0123456789', name: 'general', is_private: false },
        { id: 'C9876543210', name: 'random', is_private: false },
      ]),
    )

    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'fleet.slack-channels.listed',
        agent_name: AGENT,
        detail: expect.stringContaining('channels=2'),
      }),
    )
    const callArgs = logSecurityEventMock.mock.calls[0]
    const detail = (callArgs[0] as { detail: string }).detail
    expect(detail).not.toContain(BOT_TOKEN)
    expect(detail).toContain('truncated=false')
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — auth gate (round-7 audit on PR #49)', () => {
  // The other sibling handler test files don't exercise the
  // requireRole branches; the auditor flagged this as a
  // nice-to-have insurance against accidentally removing the
  // `if ('error' in auth)` branch without a build break. Cheap.
  it('returns 401 when requireRole rejects with Unauthenticated', async () => {
    requireRoleMock.mockReturnValueOnce({
      error: 'Authentication required',
      status: 401,
    } as never)
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(401)
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when requireRole rejects with insufficient role', async () => {
    requireRoleMock.mockReturnValueOnce({
      error: 'Forbidden',
      status: 403,
    } as never)
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(403)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — service-scope guard', () => {
  it('returns 400 InvalidAgentName for malformed name', async () => {
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams('Invalid_Name'))
    expect(resp.status).toBe(400)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('InvalidAgentName')
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 ServiceNotFoundException for missing service', async () => {
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ServiceNotFoundException')
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) for non-MC-managed service to avoid enumeration', async () => {
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'ACTIVE',
          tags: [{ key: 'Component', value: 'litellm' }],
        },
      ],
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ServiceNotFoundException')
  })

  it('returns 500 ConfigurationError when MC_AGENT_SECRETS_NAME_PREFIX is unset (round-2 audit on PR #49)', async () => {
    // Pre-fix, a missing env var would have surfaced as 502
    // deep in the SM call's catch — operator hunts Slack/AWS
    // errors when the real fix is in their MC container env.
    // Now: pre-check before any AWS call, return 500.
    delete process.env.MC_AGENT_SECRETS_NAME_PREFIX
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ConfigurationError')
    expect(ecsSendMock).not.toHaveBeenCalled()
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for DRAINING service (round-2 audit: tightened !== ACTIVE)', async () => {
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          serviceArn: SERVICE_ARN,
          status: 'DRAINING',
          tags: [
            { key: 'Component', value: 'agent-harness' },
            { key: 'ManagedBy', value: 'mission-control' },
          ],
        },
      ],
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect(smSendMock).not.toHaveBeenCalled()
  })

  it('returns 404 when DescribeServices resolves with empty services + non-empty failures (round-9 audit on PR #49)', async () => {
    // ECS reports service-not-found in `failures` (not via reject).
    // The handler logs a warn and falls through to the `!target`
    // 404. This test pins the behavior so a future refactor that
    // changes the failure-array handling is caught.
    //
    // Auditor flagged that an IAM AccessDeniedException at the
    // service-describe level would also land in `failures` and
    // surface as 404, masking the real issue. That's a known
    // systemic gap shared with sibling handlers (filed as a
    // follow-up); this test pins the not-found path.
    ecsSendMock.mockResolvedValueOnce({
      services: [],
      failures: [{ arn: SERVICE_ARN, reason: 'MISSING' }],
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ServiceNotFoundException')
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    // Warn was logged for forensic visibility
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ reason: 'MISSING' }),
        ]),
      }),
      expect.stringContaining('DescribeServices returned failures'),
    )
  })

  it('returns 502 when DescribeServices itself rejects (round-3 audit on PR #49)', async () => {
    // Round-3 caught the ECS catch branch was untested. Every
    // service-scope-guard test resolves DescribeServices; this
    // covers the throw path (throttling, IAM, transient AWS).
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('rate exceeded'), {
        name: 'ThrottlingException',
      }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('ThrottlingException')
    expect(smSendMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for INACTIVE service', async () => {
    ecsSendMock.mockResolvedValueOnce({
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — bot-token paths', () => {
  it('returns 404 SlackBotTokenNotFound when secret does not exist', async () => {
    mockHarnessService()
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('SlackBotTokenNotFound')
    expect(json.detail).toContain('credential-paste')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 502 SlackBotTokenMalformed with re-paste detail when SM returns no SecretString (round-4 audit on PR #49)', async () => {
    // Pre-fix, this fell through to the generic 502 with no
    // operator-actionable hint. Round-4 added an explicit
    // branch with a "re-paste credentials" remediation.
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: undefined })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('SlackBotTokenMalformed')
    expect(json.detail).toContain('Re-paste credentials')
  })

  it('returns 500 ConfigurationError if it surfaces from getSlackBotToken (round-7 audit on PR #49)', async () => {
    // Defensive branch: the upfront pre-check already returns
    // 500 if MC_AGENT_SECRETS_NAME_PREFIX is unset. But
    // getSlackBotToken calls requireSecretsPrefix internally as
    // a backstop — if the env var were deleted mid-request
    // (vanishingly unlikely but possible), the inner
    // ConfigurationError would land in the step-2 catch and
    // pre-fix would have surfaced as 502 (wrong status class
    // for a server-config fault). The new explicit branch
    // returns 500 instead. We simulate by throwing a synthetic
    // ConfigurationError from the SM mock — getSlackBotToken's
    // own catch re-throws non-RNFE errors, so it lands in the
    // handler's step-2 catch.
    mockHarnessService()
    smSendMock.mockRejectedValueOnce(
      Object.assign(
        new Error('MC_AGENT_SECRETS_NAME_PREFIX is not set'),
        { name: 'ConfigurationError' },
      ),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(500)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('ConfigurationError')
  })

  it('returns 502 (not 404) on AccessDeniedException — IAM grant misconfigured', async () => {
    mockHarnessService()
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('access denied'), {
        name: 'AccessDeniedException',
      }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('AccessDeniedException')
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — Slack-side errors', () => {
  it('maps invalid_auth to 502 SlackAuthError with re-paste hint', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('invalid_auth'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('SlackAuthError')
    expect(json.detail).toContain('Re-paste credentials')
  })

  it('maps token_revoked to SlackAuthError', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('token_revoked'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackAuthError')
  })

  it('maps token_expired to SlackAuthError (round-5 audit on PR #49)', async () => {
    // Pre-fix, token_expired fell through to SlackUnknownError.
    // Same remediation as invalid_auth (re-paste credentials),
    // so it should surface the same actionable hint.
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('token_expired'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackAuthError')
  })

  it('maps missing_scope to 502 SlackMissingScope with reinstall hint', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('missing_scope'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('SlackMissingScope')
    expect(json.detail).toContain('Reinstall')
  })

  it('maps HTTP 429 to 429 SlackRateLimited with Retry-After header', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({}),
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(429)
    expect(resp.headers.get('Retry-After')).toBe('30')
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackRateLimited')
  })

  it('maps account_inactive to 502 SlackAccountInactive with workspace-action hint (round-4 audit on PR #49)', async () => {
    // Pre-fix, account_inactive fell through to SlackUnknownError
    // — opaque, no UI hint. Round-4 mapped it to a distinct
    // class because re-pasting credentials WONT fix
    // workspace-level disabled state; the operator needs to
    // resolve in api.slack.com/apps first.
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('account_inactive'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('SlackAccountInactive')
    expect(json.detail).toContain('api.slack.com/apps')
  })

  it('maps app_inactive to SlackAccountInactive (same shape)', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('app_inactive'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackAccountInactive')
  })

  it('maps an unrecognized Slack error code to 502 SlackUnknownError', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('some_brand_new_error'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackUnknownError')
  })

  it('maps non-200 HTTP responses to SlackNetworkError', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({}),
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackNetworkError')
  })

  it('maps fetch throw to SlackNetworkError', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackNetworkError')
  })

  it('passes an AbortSignal with a 5s timeout to fetch (round-1 audit on PR #49)', async () => {
    // Round-1 audit asked for a fetch timeout so a degraded
    // Slack doesn't hang the API route worker. Verify the
    // wrapper supplies a timeout-bearing signal on the fetch
    // call. We don't fake-time the timeout itself (Node's
    // AbortSignal.timeout integration with vitest is fragile);
    // asserting that ANY abortable signal is passed catches
    // regression where someone removes the wiring.
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackOk([]))
    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeDefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps AbortError (timeout fired) to SlackNetworkError', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(502)
    const json = (await resp.json()) as { error: string }
    expect(json.error).toBe('SlackNetworkError')
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — Cache-Control (round-3 audit on PR #49)', () => {
  // The picker UI is interactive — a caching reverse proxy
  // (CloudFront, nginx) that cached a transient `404
  // SlackBotTokenNotFound` would keep the picker broken even
  // after the operator completed credential paste. Same risk
  // applies across 200, 400, 404, 429, 500, 502. Every response
  // path must set `Cache-Control: no-store`.
  const assertNoStore = (resp: Response) => {
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  }

  it('200 sets Cache-Control: no-store', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackOk([]))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })

  it('400 InvalidAgentName sets Cache-Control: no-store', async () => {
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams('Invalid_Name'))
    assertNoStore(resp)
  })

  it('500 ConfigurationError sets Cache-Control: no-store', async () => {
    delete process.env.MC_AGENT_SECRETS_NAME_PREFIX
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })

  it('404 ServiceNotFoundException sets Cache-Control: no-store', async () => {
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })

  it('404 SlackBotTokenNotFound sets Cache-Control: no-store', async () => {
    mockHarnessService()
    smSendMock.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })

  it('429 SlackRateLimited sets Cache-Control: no-store (alongside Retry-After)', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '15' }),
      json: async () => ({}),
    })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
    expect(resp.headers.get('Retry-After')).toBe('15')
  })

  it('502 SlackAuthError sets Cache-Control: no-store', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('invalid_auth'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })

  it('502 ECS error path sets Cache-Control: no-store', async () => {
    ecsSendMock.mockRejectedValueOnce(
      Object.assign(new Error('throttled'), { name: 'ThrottlingException' }),
    )
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    assertNoStore(resp)
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — security event severity (round-8 audit on PR #49)', () => {
  // Pre-fix, every step-2 error fired `severity: 'warning'` —
  // including operational classes that debited the workspace
  // posture score for non-security reasons. Now: genuine
  // security signals stay as 'warning'; everything else drops
  // to 'info'. Audit trail still captures all failed calls.
  const expectSeverity = async (
    setup: () => void,
    expected: 'warning' | 'info',
  ) => {
    setup()
    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    const failedEvent = logSecurityEventMock.mock.calls
      .map((c) => c[0] as { event_type: string; severity: string })
      .find((e) => e.event_type === 'fleet.slack-channels.failed')
    expect(failedEvent?.severity).toBe(expected)
  }

  it('SlackAuthError → severity: warning (genuine security signal)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
      fetchMock.mockResolvedValueOnce(slackErr('invalid_auth'))
    }, 'warning')
  })

  it('SlackMissingScope → severity: warning', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
      fetchMock.mockResolvedValueOnce(slackErr('missing_scope'))
    }, 'warning')
  })

  it('AccessDeniedException → severity: warning (IAM)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockRejectedValueOnce(
        Object.assign(new Error('access denied'), {
          name: 'AccessDeniedException',
        }),
      )
    }, 'warning')
  })

  it('SlackBotTokenNotFound → severity: info (operator hasnt run paste yet)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      )
    }, 'info')
  })

  it('SlackRateLimited → severity: info (Slack throttling)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '15' }),
        json: async () => ({}),
      })
    }, 'info')
  })

  it('SlackNetworkError → severity: info (transient infrastructure)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    }, 'info')
  })

  it('SlackAccountInactive → severity: info (workspace-level Slack state)', async () => {
    await expectSeverity(() => {
      mockHarnessService()
      smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
      fetchMock.mockResolvedValueOnce(slackErr('account_inactive'))
    }, 'info')
  })
})

describe('GET /api/fleet/agents/:name/slack/channels — token-non-leak', () => {
  it('does not include the bot token in any 200-path response field', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackOk([{ id: 'C0123456789', name: 'g', is_private: false }]))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const text = JSON.stringify(await resp.json())
    expect(text).not.toContain(BOT_TOKEN)
  })

  it('does not include the bot token in any error-path response field (Slack auth)', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('invalid_auth'))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const text = JSON.stringify(await resp.json())
    expect(text).not.toContain(BOT_TOKEN)
  })

  it('does not include the bot token in any error-path response field (network error)', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockRejectedValueOnce(new Error(`Failed to fetch with token=${BOT_TOKEN}`))
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const text = JSON.stringify(await resp.json())
    // Even if a future fetch implementation echoed the token in
    // the error message, our wrapper sanitizes it before
    // surfacing to the caller. SlackNetworkError's message is
    // generic; raw fetch error doesn't reach the response.
    expect(text).not.toContain(BOT_TOKEN)
  })

  it('does not include the bot token in any logger.error call (round-1 audit on PR #49)', async () => {
    // Round-1 audit on PR #49: prior shape embedded
    // `fetchErr.message` into SlackNetworkError.message, which
    // the handler then logged via `logger.error({ errorMessage:
    // error.message })`. If a misbehaving fetch impl echoed the
    // Authorization header in its error string, the token would
    // land in CloudWatch. Post-fix: the wrapper uses a generic
    // error message + the original error class name only, never
    // the full message string. This test asserts that contract.
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockRejectedValueOnce(new Error(`Failed to fetch with token=${BOT_TOKEN}`))
    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    const allLogged = JSON.stringify(loggerErrorMock.mock.calls)
    expect(allLogged).not.toContain(BOT_TOKEN)
  })

  it('does not include the bot token in any security-event detail', async () => {
    mockHarnessService()
    smSendMock.mockResolvedValueOnce({ SecretString: BOT_TOKEN })
    fetchMock.mockResolvedValueOnce(slackErr('invalid_auth'))
    const GET = await importHandler()
    await GET(mkRequest(), mkParams())
    const allDetails = logSecurityEventMock.mock.calls
      .map((c) => (c[0] as { detail: string }).detail)
      .join(' ')
    expect(allDetails).not.toContain(BOT_TOKEN)
  })
})

describe('PUT /api/fleet/agents/:name/slack/channels — stub for ender-stack#283', () => {
  const importPut = async () => {
    const mod = await import('../api/slack-channels')
    return mod.PUT
  }

  it('returns 401 when requireRole rejects with Unauthenticated (Beat 5c.2 round-2 audit)', async () => {
    requireRoleMock.mockReturnValueOnce({
      error: 'Authentication required',
      status: 401,
    } as never)
    const PUT = await importPut()
    const resp = await PUT(mkRequest(), mkParams())
    expect(resp.status).toBe(401)
  })

  it('returns 403 when requireRole rejects with insufficient role', async () => {
    requireRoleMock.mockReturnValueOnce({
      error: 'Forbidden',
      status: 403,
    } as never)
    const PUT = await importPut()
    const resp = await PUT(mkRequest(), mkParams())
    expect(resp.status).toBe(403)
  })

  it('returns 501 NotImplemented with ender-stack#283 hint for authenticated admin', async () => {
    const PUT = await importPut()
    const resp = await PUT(mkRequest(), mkParams())
    expect(resp.status).toBe(501)
    const json = (await resp.json()) as { error: string; detail?: string }
    expect(json.error).toBe('NotImplemented')
    expect(json.detail).toContain('ender-stack#283')
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })
})
