import { type NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
import { AGENT_NAME_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import {
  getSlackBotToken,
  requireSecretsPrefix,
} from '@/extensions/fleet/lib/secrets-manager'
import {
  listChannels,
  type SlackChannel,
} from '@/extensions/fleet/lib/slack-client'

/**
 * GET /api/fleet/agents/:name/slack/channels — Phase 2.4 Beat 5b.3.
 *
 * Returns the Slack workspace's channel list for the picker UI.
 * Reads the agent's stored bot token from Secrets Manager and
 * calls Slack `conversations.list`. Pure read endpoint.
 *
 * Auth: `admin` role.
 *
 * Service-scope guard: same two-tag check used by the manifest
 * + credentials handlers — refuses to surface channels for a
 * service that isn't a `Component=agent-harness` AND
 * `ManagedBy=mission-control` agent.
 *
 * Token-non-leak guarantee (round-2 audit on ender-stack#276):
 * the bot token is read from SM, passed straight to the Slack
 * client as a Bearer header, and never logged, returned, or
 * surfaced in error payloads. Security events log the actor +
 * agent + channel count only — never the token.
 *
 * MC-as-aggregate-credential-proxy posture: the IAM grant
 * (Beat 5b.3a, ender-stack#276) scopes GetSecretValue to
 * `companion-openclaw-*-slack-bot-token*` — i.e. MC can read
 * any agent's bot token, not just the one this request targets.
 * This is intentional (the picker may open while the agent
 * task is offline, so MC can't proxy through the agent
 * container). Documented in the threat model. Recurring sweeps
 * through CloudTrail's `secretsmanager:GetSecretValue` events
 * filtered by the MC role ARN are the audit boundary.
 */

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })

// Round-3 audit on PR #49: every response (success AND error)
// sets `Cache-Control: no-store`. The picker UI is interactive
// and a caching reverse proxy that cached a transient 404
// `SlackBotTokenNotFound` would keep the picker broken after
// the operator completes the credential-paste flow. Same risk
// applies to 429 / 502 / 500 / 400.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

export interface SlackChannelsResponse {
  ok: true
  agentName: string
  channels: SlackChannel[]
  /** True if Slack returned a non-empty next_cursor; UI should hint at it. */
  truncated: boolean
}

export interface SlackChannelsErrorResponse {
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
      } satisfies SlackChannelsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Pre-check the secrets prefix env var BEFORE any AWS call —
  // ConfigurationError surfaces as a 500 (server misconfigured),
  // not a 502 (upstream failure). Round-2 audit on PR #49: a
  // missing MC_AGENT_SECRETS_NAME_PREFIX would have surfaced as
  // 502 deep in the SM call's catch block, sending the operator
  // hunting Slack/AWS errors when the real fix is in their MC
  // container env config. Mirrors slack-credentials.ts:322.
  try {
    requireSecretsPrefix()
  } catch (err) {
    return NextResponse.json(
      {
        error: 'ConfigurationError',
        detail: (err as Error).message,
      } satisfies SlackChannelsErrorResponse,
      { status: 500, headers: NO_STORE },
    )
  }

  const fleetPrefix = resolveFleetPrefix()
  const clusterName = fleetPrefix.clusterName
  const serviceName = `${fleetPrefix.prefix}-companion-openclaw-${agentName}`

  // Step 1: verify the agent service exists + is MC-managed.
  // Same two-tag guard as slack-manifest / slack-credentials so
  // this endpoint can't be used to enumerate platform services.
  try {
    const describe = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
        include: ['TAGS'],
      }),
    )
    if (describe.failures && describe.failures.length > 0) {
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          failures: describe.failures,
        },
        '[fleet] slack-channels: DescribeServices returned failures',
      )
    }
    const target = describe.services?.[0]
    // Round-2 audit on PR #49: tighten to `!== 'ACTIVE'` so
    // DRAINING services (mid-stop / mid-deploy) are also
    // rejected. Same fix shape as PR #48 round-2. Read endpoint
    // blast radius is lower than credentials-write but the guard
    // logic shouldn't diverge between sibling handlers.
    if (!target || target.status !== 'ACTIVE') {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackChannelsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
    if (!isAgentHarness(target)) {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackChannelsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
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
      '[fleet] slack-channels: AWS ECS error',
    )
    return NextResponse.json(
      { error: error.name || 'AWSError' } satisfies SlackChannelsErrorResponse,
      { status: 502, headers: NO_STORE },
    )
  }

  // Step 2: read the bot token + call Slack. Wrapped in its own
  // try/catch so SM and Slack errors get distinct status codes
  // and the security-event detail can capture which side failed.
  try {
    const botToken = await getSlackBotToken(agentName)
    const result = await listChannels(botToken)

    logSecurityEvent({
      event_type: 'fleet.slack-channels.listed',
      severity: 'info',
      source: 'fleet',
      agent_name: agentName,
      detail: `actor=${auth.user.id} channels=${result.channels.length} truncated=${result.truncated}`,
    })

    return NextResponse.json(
      {
        ok: true,
        agentName,
        channels: result.channels,
        truncated: result.truncated,
      } satisfies SlackChannelsResponse,
      { status: 200, headers: NO_STORE },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string; retryAfter?: string }

    // Token-non-leak: log error.name + error.message but NEVER
    // any field of the bot-token value. The error.message strings
    // emitted by getSlackBotToken + listChannels deliberately
    // don't contain token material. This is the audit boundary.
    logger.error(
      {
        agentName,
        errorName: error.name,
        errorMessage: error.message,
      },
      '[fleet] slack-channels: bot-token or Slack-API error',
    )

    // Round-8 audit on PR #49: branch severity by error class.
    // Pre-fix, every step-2 error fired `severity: 'warning'`,
    // including operational classes (SlackBotTokenNotFound,
    // SlackRateLimited, SlackNetworkError) — those debited the
    // workspace posture score for non-security reasons. Now:
    // genuine security signals stay as `warning`; everything
    // else (operator-setup state + transient infrastructure
    // noise) drops to `info`. Audit trail still captures all
    // failed calls.
    const SECURITY_RELEVANT_ERRORS = new Set([
      'SlackAuthError',
      'SlackMissingScope',
      'AccessDeniedException',
    ])
    const severity: 'warning' | 'info' = SECURITY_RELEVANT_ERRORS.has(
      error.name ?? '',
    )
      ? 'warning'
      : 'info'

    logSecurityEvent({
      event_type: 'fleet.slack-channels.failed',
      severity,
      source: 'fleet',
      agent_name: agentName,
      detail: `actor=${auth.user.id} error=${error.name ?? 'AWSError'}`,
    })

    // Round-7 audit on PR #49: `getSlackBotToken` calls
    // `requireSecretsPrefix()` internally as a defense-in-depth
    // backstop. If the env var were deleted mid-request (unlikely
    // but possible), the inner ConfigurationError would have
    // fallen through to the generic 502 below — wrong status
    // class for a server-config fault. Surface 500 here for
    // parity with the upfront pre-check.
    if (error.name === 'ConfigurationError') {
      return NextResponse.json(
        {
          error: 'ConfigurationError',
          detail: error.message,
        } satisfies SlackChannelsErrorResponse,
        { status: 500, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackBotTokenNotFound') {
      return NextResponse.json(
        {
          error: 'SlackBotTokenNotFound',
          detail: `No Slack bot token stored for agent "${agentName}". Run the credential-paste flow first.`,
        } satisfies SlackChannelsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackBotTokenMalformed') {
      // Round-4 audit on PR #49: was falling through to the
      // generic 502 with no operator-actionable detail. The
      // remediation is the same as a token rejection — re-paste
      // credentials — so surface that explicitly.
      return NextResponse.json(
        {
          error: 'SlackBotTokenMalformed',
          detail:
            'The stored bot token is corrupt or empty (Secrets Manager returned no SecretString). Re-paste credentials in the agent panel.',
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackAuthError') {
      return NextResponse.json(
        {
          error: 'SlackAuthError',
          detail:
            'Slack rejected the stored bot token. Re-paste credentials in the agent panel.',
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackMissingScope') {
      return NextResponse.json(
        {
          error: 'SlackMissingScope',
          detail:
            'Bot is missing required scopes (channels:read + groups:read). Reinstall the app from the manifest, then re-paste credentials.',
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackAccountInactive') {
      return NextResponse.json(
        {
          error: 'SlackAccountInactive',
          detail:
            "Slack workspace or app is inactive. The Slack workspace's plan may be suspended, or the app was deleted from the workspace. Resolve in api.slack.com/apps before re-pasting credentials.",
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    if (error.name === 'SlackRateLimited') {
      const headers: Record<string, string> = { ...NO_STORE }
      if (error.retryAfter) headers['Retry-After'] = error.retryAfter
      return NextResponse.json(
        {
          error: 'SlackRateLimited',
          detail: 'Slack rate-limited the request. Retry after the indicated interval.',
        } satisfies SlackChannelsErrorResponse,
        { status: 429, headers },
      )
    }
    // Round-6 audit on PR #49: the catch handles BOTH AWS-side
    // (e.g. AccessDeniedException) and Slack-side (SlackNetworkError,
    // SlackUnknownError) paths. The previous 'AWSError' fallback
    // misled operators on Slack-side throws where `error.name` was
    // somehow stripped. The known Slack/SM cases above already hit
    // explicit branches; this fallback only fires if `error.name`
    // is missing, which is unlikely but worth labeling correctly.
    return NextResponse.json(
      {
        error: error.name || 'UnknownError',
      } satisfies SlackChannelsErrorResponse,
      { status: 502, headers: NO_STORE },
    )
  }
}

/**
 * PUT /api/fleet/agents/:name/slack/channels — Phase 2.4 Beat 5c.2.
 *
 * Stub. The picker UI's Save button hits this endpoint to update
 * the agent's channel selection without re-pasting tokens. The
 * existing POST /slack/credentials handler requires all three
 * tokens; a channels-only update path needs a separate handler
 * that reads the existing tokens out of SM and writes only the
 * OPENCLAW_SLACK_CONFIG_JSON env on the gateway container.
 *
 * That handler is tracked as ender-stack#283. Until it ships,
 * this stub returns a well-formed JSON 501 so the picker's
 * existing `saveState.status === 501` branch fires and the
 * operator sees the actionable follow-up hint (rather than
 * the Next.js default HTML 405 if PUT had no handler at all,
 * which the round-1 audit on PR #51 caught).
 *
 * Auth: admin role — round-2 audit on PR #51 caught the PUT
 * stub being unauthenticated. Even a 501 response shouldn't
 * leak the existence of the endpoint / internal tracker
 * reference to unauthenticated callers.
 *
 * Remove this stub when ender-stack#283 lands the real handler.
 */
export async function PUT(
  request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: { params: Promise<{ name: string }> },
) {
  // Round-4 audit on PR #51: signature mirrors GET so the
  // ender-stack#283 implementer reaches for `params` rather
  // than re-discovering the convention. The current stub
  // doesn't read params (returns 501 unconditionally) so the
  // arg is `_`-prefixed and lint-suppressed.
  //
  // TODO(ender-stack#283): when the real handler lands:
  //   1. Validate agentName via `AGENT_NAME_RE` (mirror GET's
  //      check at the top of the function — currently skipped
  //      because the 501 stub doesn't read params).
  //   2. In the picker's fetch-success path, filter
  //      `selected` to the intersection with returned channel
  //      IDs — round-5 audit on PR #51 caught the
  //      ghost-selection trap where a channel deleted between
  //      fetch+retry can leave a stale ID in the selection.
  //   3. Remove this stub + the picker's 501 JSX branch + the
  //      picker's #283 hint test (TODO markers at each site).
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    {
      error: 'NotImplemented',
      detail:
        'Channels-only update path not yet wired — see ender-stack#283.',
    } satisfies SlackChannelsErrorResponse,
    { status: 501, headers: NO_STORE },
  )
}
