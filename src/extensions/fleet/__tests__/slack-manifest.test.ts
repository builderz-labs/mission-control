import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as auth from '@/lib/auth'

const ecsSendMock = vi.fn()

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'DescribeServicesCommand',
    input,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { id: 'test', role: 'admin' } })),
}))

const importHandler = async () => {
  const mod = await import('../api/slack-manifest')
  return mod.GET
}

const setRequiredEnv = () => {
  process.env.AWS_REGION = 'us-east-1'
  process.env.MC_FLEET_CLUSTER_NAME = 'ender-stack-dev'
  process.env.MC_FLEET_PROJECT_NAME = 'ender-stack'
  process.env.MC_FLEET_ENVIRONMENT = 'dev'
}

const AGENT = 'hello-bot'
const SERVICE_NAME = `ender-stack-dev-companion-openclaw-${AGENT}`
const SERVICE_ARN = `arn:aws:ecs:us-east-1:398152419239:service/ender-stack-dev/${SERVICE_NAME}`

const mkRequest = () =>
  ({
    url: `http://localhost/api/fleet/agents/${AGENT}/slack/manifest`,
  }) as unknown as Parameters<Awaited<ReturnType<typeof importHandler>>>[0]

const mkParams = (name: string = AGENT) => ({
  params: Promise.resolve({ name }),
})

beforeEach(() => {
  setRequiredEnv()
  ecsSendMock.mockReset()
})

describe('GET /api/fleet/agents/:name/slack/manifest — happy path', () => {
  it('returns 200 with manifest + instructions for an MC-managed agent', async () => {
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(200)
    const json = (await resp.json()) as {
      ok: boolean
      agentName: string
      manifest: Record<string, unknown>
      instructions: string[]
    }
    expect(json.ok).toBe(true)
    expect(json.agentName).toBe(AGENT)
    expect(Array.isArray(json.instructions)).toBe(true)
    expect(json.instructions.length).toBeGreaterThan(0)
  })

  it('manifest enables Socket Mode (no request URLs needed)', async () => {
    // The architectural decision: Socket Mode means no public ingress.
    // Manifest must enable it. Asserting the flag explicitly catches
    // a regression that would silently break the no-ingress contract.
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as {
      manifest: {
        settings: { socket_mode_enabled: boolean }
      }
    }
    expect(json.manifest.settings.socket_mode_enabled).toBe(true)
  })

  it('manifest does NOT include request_url anywhere (Socket Mode contract)', async () => {
    // With Socket Mode, request_url fields under event_subscriptions
    // and interactivity must be absent. If a regression adds them
    // back, the manifest still works on Slack's side BUT the
    // architectural promise of "no public ingress" is silently
    // broken — Slack would prefer the URL over the socket.
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as {
      manifest: Record<string, unknown>
    }
    const serialized = JSON.stringify(json.manifest)
    expect(serialized).not.toContain('request_url')
  })

  it('manifest sets bot_user.display_name to the agent name', async () => {
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as {
      manifest: { features: { bot_user: { display_name: string } } }
    }
    expect(json.manifest.features.bot_user.display_name).toBe(AGENT)
  })

  it('manifest scopes include the minimum needed for read + reply (chat:write, app_mentions:read, channels:history)', async () => {
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as {
      manifest: { oauth_config: { scopes: { bot: string[] } } }
    }
    const scopes = json.manifest.oauth_config.scopes.bot
    expect(scopes).toContain('chat:write')
    expect(scopes).toContain('app_mentions:read')
    expect(scopes).toContain('channels:history')
  })

  it('instructions tell the operator to enable Socket Mode AND generate App-Level Token', async () => {
    // The most common operator mistake on first-time setup: pasting
    // manifest + installing app, forgetting to flip on Socket Mode +
    // generate the App-Level Token. The instructions must be explicit
    // because the manifest's `socket_mode_enabled` flag does NOT
    // automatically generate that token (Slack requires a manual
    // step under "Basic Information → App-Level Tokens").
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    const json = (await resp.json()) as { instructions: string[] }
    const allText = json.instructions.join(' ').toLowerCase()
    expect(allText).toContain('socket mode')
    expect(allText).toContain('app-level token')
    expect(allText).toContain('connections:write')
  })
})

describe('GET /api/fleet/agents/:name/slack/manifest — refusal paths', () => {
  it('returns 404 when service does not exist', async () => {
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
  })

  it('returns 404 when service exists but is INACTIVE', async () => {
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

  it('returns 404 for a service without Component=agent-harness tag (platform service protection)', async () => {
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
  })

  it('returns 404 for an agent-harness without ManagedBy=mission-control (smoke-test protection)', async () => {
    // Smoke-test has Component=agent-harness AND ManagedBy=terraform.
    // Refusing to surface its manifest here (even though the agent
    // is an agent-harness) protects the Terraform-owned smoke-test
    // from out-of-band Slack wiring via this endpoint.
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
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
  })

  it('returns 403 when caller is not admin', async () => {
    vi.mocked(auth.requireRole).mockReturnValueOnce({
      error: 'Forbidden',
      status: 403,
    } as unknown as ReturnType<typeof auth.requireRole>)
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(403)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })

  it('returns 400 when agentName fails AGENT_NAME_RE', async () => {
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams('UPPERCASE-NAME'))
    expect(resp.status).toBe(400)
    expect(ecsSendMock).not.toHaveBeenCalled()
  })
})

describe('renderSlackManifest (template-level)', () => {
  it('truncates a >140-char role description for display_information.description', async () => {
    // Slack's manifest schema caps description at 140 chars. Operator-
    // supplied role descriptions can be longer (the field is up to
    // ROLE_DESCRIPTION_MAX_BYTES = 1024 in the create-agent flow).
    // The template must not produce an invalid manifest at paste time.
    const { renderSlackManifest } = await import(
      '../templates/slack-manifest'
    )
    const long = 'a'.repeat(200)
    const m = renderSlackManifest({
      agentName: 'bot',
      roleDescription: long,
    })
    expect(m.display_information.description.length).toBeLessThanOrEqual(140)
  })

  it('passes through a short role description unchanged', async () => {
    const { renderSlackManifest } = await import(
      '../templates/slack-manifest'
    )
    const m = renderSlackManifest({
      agentName: 'bot',
      roleDescription: 'Says hello',
    })
    expect(m.display_information.description).toBe('Says hello')
  })
})
