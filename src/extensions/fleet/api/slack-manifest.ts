import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
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

// ender-stack#278 follow-up (PR #53 round-2 audit): same sweep
// applied to all 3 Slack endpoints (credentials, channels,
// manifest) plus redeploy.ts. Pre-fix only the 200 path had it;
// a caching reverse proxy caching a transient 404 / 502 would
// have been just as misleading as the credentials case.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

export interface SlackManifestResponse {
  ok: true
  agentName: string
  manifest: SlackAppManifest
  /**
   * Stable code-named instructions the UI renders next to the
   * JSON.
   *
   * The actual security guarantee is that
   * `SLACK_HANDSHAKE_INSTRUCTIONS` is a compile-time `const`
   * tuple in this file — these strings are server-controlled,
   * not derived from operator input or task-def env. The UI's
   * `linkifyUrls` consumer wraps any `https?://` matches in
   * `<a href={...}>`, so per-agent dynamic instructions would
   * become an open-redirect surface (the `https?://` regex
   * prefix blocks `javascript:` but not attacker-supplied
   * https redirects).
   *
   * `readonly string[]` is a UI-side hint, not a load-bearing
   * compiler enforcement: TypeScript treats `string[]` as a
   * subtype of `readonly string[]`, so future code that writes
   * `instructions: someMutableArray` would still type-check.
   * If you're considering wiring dynamic per-agent instructions
   * here: re-review `linkifyUrls` first.
   */
  instructions: readonly string[]
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
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    )
  }

  const { name: agentName } = await params

  if (!agentName || !AGENT_NAME_RE.test(agentName)) {
    return NextResponse.json(
      {
        error: 'InvalidAgentName',
        detail: `agentName must match ${AGENT_NAME_RE.source}`,
      } satisfies SlackManifestErrorResponse,
      { status: 400, headers: NO_STORE },
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
    // ender-stack#277: tightened from `=== 'INACTIVE'` to
    // `!== 'ACTIVE'` so DRAINING services (mid-stop / mid-deploy)
    // are also rejected. Same shape as PR #48 round-2 + PR #49
    // round-2 fixes for the credentials + channels handlers.
    if (!target || target.status !== 'ACTIVE') {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackManifestErrorResponse,
        { status: 404, headers: NO_STORE },
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
        { status: 404, headers: NO_STORE },
      )
    }

    // Pull AGENT_DISPLAY_NAME + OPENCLAW_ROLE_DESCRIPTION from the
    // task-def env block. DescribeServices doesn't expose env vars, so
    // a second DescribeTaskDefinition call is required. Both values are
    // operator-supplied via the create-agent form; when absent (legacy
    // agents, or agents created without the optional displayName), the
    // manifest falls back to agentName and a generic description.
    //
    // Read from the init-config container first, falling back to other
    // containers. Today AGENT_DISPLAY_NAME lives on commonEnv (same
    // value on every container) and OPENCLAW_ROLE_DESCRIPTION on
    // gatewayOnlyEnv (gateway container only), so a flat last-writer-
    // wins map would happen to be correct — but the templates layout
    // is the only thing making it correct. A future refactor that moves
    // either var or adds a container-specific override should not
    // silently get the wrong value here. Mirror the targeted lookup
    // pattern in slack-channels.ts.
    const taskDefinition = target.taskDefinition
    let displayName: string | undefined
    let roleDescription = `Mission Control agent ${agentName}`
    if (taskDefinition) {
      try {
        const tdResp = await ecsClient.send(
          new DescribeTaskDefinitionCommand({ taskDefinition }),
        )
        const containers = tdResp.taskDefinition?.containerDefinitions ?? []
        const orderedContainers = [
          ...containers.filter((c) => c.name === 'init-config'),
          ...containers.filter((c) => c.name !== 'init-config'),
        ]
        const readEnv = (name: string): string | undefined => {
          for (const c of orderedContainers) {
            for (const kv of c.environment ?? []) {
              if (kv.name === name && typeof kv.value === 'string') {
                const trimmed = kv.value.trim()
                if (trimmed) return trimmed
              }
            }
          }
          return undefined
        }
        displayName = readEnv('AGENT_DISPLAY_NAME')
        // Read AGENT_ROLE (canonical commonEnv name) first; fall back to
        // the legacy OPENCLAW_ROLE_DESCRIPTION alias (gatewayOnlyEnv) for
        // forward-compatibility. The legacy alias is documented in
        // openclaw.ts as "transitional, can be removed in a future cleanup
        // PR once upstream openclaw standardizes on AGENT_ROLE end-to-
        // end" — when that cleanup lands, reading the canonical name
        // first keeps this handler working without further changes.
        const role =
          readEnv('AGENT_ROLE') ?? readEnv('OPENCLAW_ROLE_DESCRIPTION')
        // Collapse interior whitespace so a multi-line role description
        // (textarea input) renders cleanly in Slack's single-line app
        // description. truncateForSlack still enforces the 140-char cap.
        if (role) roleDescription = role.replace(/\s+/g, ' ')
      } catch (err) {
        // Non-fatal: log and fall through to the generic fallback so the
        // operator still gets a working (if less personalized) manifest
        // when DescribeTaskDefinition fails (IAM, throttle, etc.).
        const e = err as { name?: string; message?: string }
        logger.warn(
          {
            cluster: clusterName,
            serviceName,
            taskDefinition,
            errorName: e.name,
            errorMessage: e.message,
          },
          '[fleet] slack-manifest: DescribeTaskDefinition failed; using fallback values',
        )
      }
    }

    const manifest = renderSlackManifest({
      agentName,
      roleDescription,
      displayName,
    })

    return NextResponse.json(
      {
        ok: true,
        agentName,
        manifest,
        // Spread the const-asserted tuple into a fresh array.
        // Both the source (`SLACK_HANDSHAKE_INSTRUCTIONS as const`)
        // and the response field (`readonly string[]`, narrowed in
        // PR #50 round-5) are immutable; the spread just shapes
        // the value to match the response type without aliasing
        // the const tuple back into a wider array reference.
        instructions: [...SLACK_HANDSHAKE_INSTRUCTIONS],
      } satisfies SlackManifestResponse,
      { status: 200, headers: NO_STORE },
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
      { status: 502, headers: NO_STORE },
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
  'Paste the JSON manifest above (replacing any existing content). Click Next, then Create. Socket Mode is enabled automatically by the manifest — no separate toggle needed.',
  'On the "Basic Information" page, scroll to "App Credentials" and copy the "Signing Secret" — this is your SIGNING SECRET.',
  'On the same page, scroll to "App-Level Tokens" and click "Generate Token and Scopes". Add the `connections:write` scope, set the token name to your agent name, then click "Generate". Copy the `xapp-...` token — this is your APP-LEVEL TOKEN.',
  'Click "Install App" in the sidebar, then "Install to Workspace". Approve the requested permissions, then copy the "Bot User OAuth Token" (starts with `xoxb-...`) — this is your BOT TOKEN.',
  'Return to Mission Control and paste all three values into the Slack credentials form below.',
] as const
