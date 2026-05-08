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

  it('manifest scopes match the standard OpenClaw Slack-app shape (RAID-aligned 2026-05-04)', async () => {
    // Beat 5e validation surfaced that the prior narrower scope
    // set caused SlackMissingScope from conversations.list because
    // the channel picker requests both public + private types
    // (channels:read + groups:read together). Aligned with the
    // operator's hand-crafted RAID/Leverage Demo Agent template
    // so MC-created agents match expectations out-of-the-box.
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
    // Public + private channel discovery (the original Beat 5e
    // blocker — channels:read alone wasn't enough for the picker).
    expect(scopes).toContain('channels:read')
    expect(scopes).toContain('groups:read')
    // History scopes for context retrieval.
    expect(scopes).toContain('channels:history')
    expect(scopes).toContain('groups:history')
    expect(scopes).toContain('im:history')
    expect(scopes).toContain('mpim:history')
    // Send + customize + react.
    expect(scopes).toContain('chat:write')
    expect(scopes).toContain('chat:write.customize')
    expect(scopes).toContain('reactions:write')
    // File uploads.
    expect(scopes).toContain('files:write')
    // DM handling + user resolution.
    expect(scopes).toContain('im:read')
    expect(scopes).toContain('im:write')
    expect(scopes).toContain('users:read')
    // app_mentions:read intentionally NOT in the OAuth scope set —
    // mentions are subscribed via bot_events, not OAuth scopes.
    expect(scopes).not.toContain('app_mentions:read')
  })

  it('manifest bot_events match the standard OpenClaw firehose shape', async () => {
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
        settings: { event_subscriptions: { bot_events: string[] } }
      }
    }
    const events = json.manifest.settings.event_subscriptions.bot_events
    // Full firehose for all channel types the bot is invited to.
    expect(events).toContain('message.channels')
    expect(events).toContain('message.groups')
    expect(events).toContain('message.im')
    expect(events).toContain('message.mpim')
    // app_mention NOT in the default set — it's redundant with
    // message.channels (mentions ARE messages); subscribing
    // separately doubles wakeup count for the same event.
    expect(events).not.toContain('app_mention')
  })

  it('instructions: signing secret first, then app-level token, then install app', async () => {
    // Operator-validated ordering (Beat 5e feedback): the natural
    // flow on the Slack admin page goes Basic Information →
    // signing secret → app-level token → Install App. Earlier
    // versions of the instructions had Socket Mode toggle as a
    // separate step; the manifest's `socket_mode_enabled: true`
    // makes that automatic so the toggle step has been dropped.
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

    // Token-related steps still required.
    expect(allText).toContain('app-level token')
    expect(allText).toContain('connections:write')
    expect(allText).toContain('signing secret')

    // Manual Socket Mode toggle step should be GONE — the manifest
    // sets socket_mode_enabled: true so it's auto-enabled per app.
    // The earlier "click Socket Mode and toggle Enable Socket Mode
    // to on" instruction was redundant per operator feedback.
    // Test by inspecting individual instruction items rather than
    // the joined string (which would let .* span across items).
    for (const step of json.instructions) {
      const lower = step.toLowerCase()
      expect(lower).not.toMatch(/click "socket mode"|enable socket mode/)
    }

    // Ordering: signing secret instruction comes BEFORE app-level
    // token instruction; install app instruction comes AFTER both.
    const signingIdx = json.instructions.findIndex((s) =>
      s.toLowerCase().includes('signing secret'),
    )
    const appLevelIdx = json.instructions.findIndex((s) =>
      s.toLowerCase().includes('app-level token'),
    )
    const installIdx = json.instructions.findIndex((s) =>
      s.toLowerCase().includes('install app'),
    )
    expect(signingIdx).toBeGreaterThan(-1)
    expect(appLevelIdx).toBeGreaterThan(-1)
    expect(installIdx).toBeGreaterThan(-1)
    expect(signingIdx).toBeLessThan(appLevelIdx)
    expect(appLevelIdx).toBeLessThan(installIdx)
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

  it('sets Cache-Control: no-store on the 404 (ender-stack#278 — sweep)', async () => {
    ecsSendMock.mockResolvedValueOnce({ services: [] })
    const GET = await importHandler()
    const resp = await GET(mkRequest(), mkParams())
    expect(resp.status).toBe(404)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 404 when service status is DRAINING (ender-stack#277 — !== ACTIVE tightening)', async () => {
    // Pre-fix: `=== 'INACTIVE'` would let DRAINING services
    // through. Post-fix: any non-ACTIVE state is rejected.
    // Same shape as PR #48 round-2 / PR #49 round-2 fixes.
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
