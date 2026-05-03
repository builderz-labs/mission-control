import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { AGENT_NAME_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import {
  renderSlackManifest,
  type SlackAppManifest,
} from '@/extensions/fleet/templates/slack-manifest'

/**
 * GET /api/fleet/agents/:name/slack/manifest — Phase 2.4 Beat 5b.1.
 *
 * Returns the Slack app manifest JSON the operator pastes into
 * api.slack.com/apps "Create New App → From Manifest" to wire this
 * agent into a Slack workspace. Pure read endpoint; no side effects.
 *
 * Auth: `admin` role. The manifest itself isn't a secret (it's an
 * app blueprint), but it surfaces the agent's name + role
 * description, which today are admin-only inputs.
 *
 * Service-scope guard: same two-tag check used by the delete-agent
 * handler — refuses to surface a manifest for a service that isn't
 * a `Component=agent-harness` AND `ManagedBy=mission-control`
 * agent. This prevents leakage of platform-service metadata
 * (mission-control, litellm, smoke-test) via this endpoint.
 *
 * The handler reads the agent's role description out of the live
 * task-def's environment block (`OPENCLAW_ROLE_DESCRIPTION` env
 * var). Phase-2.4 doesn't have a dedicated agent-metadata store —
 * the task-def is the canonical record.
 */

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })

export interface SlackManifestResponse {
  ok: true
  agentName: string
  manifest: SlackAppManifest
  /** Stable code-named instructions the UI renders next to the JSON. */
  instructions: string[]
}

export interface SlackManifestErrorResponse {
  error: string
  detail?: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { name: agentName } = await params

  if (!agentName || !AGENT_NAME_RE.test(agentName)) {
    return NextResponse.json(
      {
        error: 'InvalidAgentName',
        detail: `agentName must match ${AGENT_NAME_RE.source}`,
      } satisfies SlackManifestErrorResponse,
      { status: 400 },
    )
  }

  const fleetPrefix = resolveFleetPrefix()
  const clusterName = fleetPrefix.clusterName
  const serviceName = `${fleetPrefix.prefix}-companion-openclaw-${agentName}`

  try {
    const describe = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
        include: ['TAGS'],
      }),
    )
    // Log any DescribeServices `failures` entries (AWS returns
    // these alongside an empty `services[]` for not-found / IAM-
    // shortage cases). Round-1 audit on PR #47 flagged that
    // throttling or unusual partial-result shapes would otherwise
    // be invisible in CloudWatch when the request resolves to a
    // 404 here. Most common entry is `{reason: "MISSING"}` which
    // is normal; non-MISSING reasons are worth surfacing.
    if (describe.failures && describe.failures.length > 0) {
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          failures: describe.failures,
        },
        '[fleet] slack-manifest: DescribeServices returned failures',
      )
    }
    const target = describe.services?.[0]
    if (!target || target.status === 'INACTIVE') {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackManifestErrorResponse,
        { status: 404 },
      )
    }
    if (!isAgentHarness(target)) {
      // 404 (not 403) — refuse to confirm existence of non-harness
      // service. Same convention as agents-delete.ts.
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackManifestErrorResponse,
        { status: 404 },
      )
    }

    // Fall back to a generic description — DescribeServices doesn't
    // expose the task-def env block (where OPENCLAW_ROLE_DESCRIPTION
    // lives). Pulling the operator's actual role description would
    // require a separate DescribeTaskDefinition call, which isn't
    // worth the extra round-trip for a UX-nicety field that shows
    // up only in Slack's app description. Phase-2.x can wire it
    // through if/when there's a reason to.
    const roleDescription = `Mission Control agent ${agentName}`

    const manifest = renderSlackManifest({
      agentName,
      roleDescription,
    })

    return NextResponse.json(
      {
        ok: true,
        agentName,
        manifest,
        // Spread to drop the readonly modifier on the const-asserted
        // tuple — the response interface declares `instructions:
        // string[]` (mutable) so it can carry future per-deployment
        // overrides without changing the wire shape.
        instructions: [...SLACK_HANDSHAKE_INSTRUCTIONS],
      } satisfies SlackManifestResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string }
    logger.error(
      {
        cluster: clusterName,
        serviceName,
        agentName,
        errorName: error.name,
        errorMessage: error.message,
      },
      '[fleet] slack-manifest: AWS error',
    )
    return NextResponse.json(
      { error: error.name || 'AWSError' } satisfies SlackManifestErrorResponse,
      { status: 502 },
    )
  }
}

/**
 * Step-by-step instructions the UI renders next to the manifest
 * JSON. Stable text, kept here so the API + the UI render the same
 * thing. Operators paste the manifest into api.slack.com/apps and
 * follow these steps to extract the three tokens MC will need at
 * the credential-paste step (Beat 5b.2).
 *
 * Why these are stable strings (vs i18n'd UI labels): they're
 * external (Slack's UI), the URLs are stable, and any reword breaks
 * the operator's mental model. Plain-text, locked-in.
 */
const SLACK_HANDSHAKE_INSTRUCTIONS = [
  'Go to https://api.slack.com/apps and click "Create New App".',
  'Choose "From an app manifest", select your workspace, click Next.',
  'Paste the JSON manifest above (replacing any existing content). Click Next, then Create.',
  'In the app sidebar, click "Socket Mode" and toggle "Enable Socket Mode" to on.',
  'When prompted, generate an App-Level Token with the `connections:write` scope. Copy the `xapp-...` token — this is your APP-LEVEL TOKEN.',
  'Click "Install App" in the sidebar, then "Install to Workspace". Approve the requested permissions.',
  'After install, copy the "Bot User OAuth Token" (starts with `xoxb-...`) — this is your BOT TOKEN.',
  'Click "Basic Information" in the sidebar, scroll to "App Credentials", and copy the "Signing Secret" — this is your SIGNING SECRET.',
  'Return to Mission Control and paste all three values into the Slack credentials form below.',
] as const
