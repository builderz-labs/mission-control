import { type NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
  type RegisterTaskDefinitionCommandInput,
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
import {
  MAX_CHANNELS_PER_AGENT,
  extractOwnerSlackId,
  injectChannelsIntoInit,
  serializeChannelInputs,
  validateChannelInputs,
  validatePrimaryAssignment,
  type ChannelInput,
} from '@/extensions/fleet/lib/slack-channel-injection'
import { stripReadOnlyFields } from '@/extensions/fleet/lib/ecs-task-def-helpers'
import { writeSlackChannelConfigToSsm } from '@/extensions/fleet/lib/slack-ssm-bridge'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  withTimeout,
  upstreamErrorBody,
  classifyEcsFailures,
  UPSTREAM_ERROR_CODE,
} from '@/extensions/fleet/lib/aws-hardening'

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
  /**
   * Agent owner Slack ID (#494/#501), read from the live task-def's
   * init-config AGENT_OWNER_SLACK_ID env var when it matches
   * SLACK_USER_ID_RE. Lets the picker prefill a primary channel's
   * assignedUsers with the owner and skip the no-owner primary block
   * client-side. `undefined` when the agent has no usable owner — the
   * lookup is best-effort and never fails the channel-list response.
   */
  ownerSlackId?: string
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

  // #501: agent owner Slack ID for the picker's primary-channel
  // prefill. Populated best-effort inside the Step-1 try (we already
  // describe the service there); a failed/absent owner lookup leaves
  // this undefined and never blocks the channel-list response.
  let ownerSlackId: string | undefined

  // Step 1: verify the agent service exists + is MC-managed.
  // Same two-tag guard as slack-manifest / slack-credentials so
  // this endpoint can't be used to enumerate platform services.
  try {
    // ender-stack#280: per-call timeout so a stuck ECS call can't hang the request.
    const describe = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName],
            include: ['TAGS'],
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    // ender-stack#281: a non-MISSING failure (e.g. IAM denial) must 502, not
    // fall through to the not-found 404 below.
    const classified = classifyEcsFailures(describe.failures)
    if (classified.missing.length > 0) {
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          failures: classified.missing,
        },
        '[fleet] slack-channels: DescribeServices returned MISSING failures',
      )
    }
    if (classified.hasNonMissing) {
      logger.error(
        {
          cluster: clusterName,
          serviceName,
          denied: classified.denied,
          other: classified.other,
        },
        '[fleet] slack-channels: DescribeServices returned non-MISSING failures (likely IAM denial)',
      )
      return NextResponse.json(upstreamErrorBody(), {
        status: 502,
        headers: NO_STORE,
      })
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

    // #501: best-effort owner lookup. The owner Slack ID lives on the
    // init-config container env of the live task-def (set at create
    // time). Reuse the same DescribeTaskDefinition + extractOwnerSlackId
    // the PUT handler uses — `ecs:DescribeTaskDefinition` is already
    // granted (no new IAM action). The channel list is the primary
    // payload; owner is enrichment, so any failure here degrades to
    // `ownerSlackId = undefined` rather than erroring the picker.
    try {
      const liveTaskDefArn = target.taskDefinition
      if (liveTaskDefArn) {
        const tdResp = await (async () => {
          const t = withTimeout()
          try {
            return await ecsClient.send(
              new DescribeTaskDefinitionCommand({
                taskDefinition: liveTaskDefArn,
              }),
              { abortSignal: t.signal },
            )
          } finally {
            t.clear()
          }
        })()
        const containers = tdResp.taskDefinition?.containerDefinitions
        if (containers) ownerSlackId = extractOwnerSlackId(containers)
      }
    } catch (ownerErr) {
      const e = ownerErr as { name?: string; message?: string }
      logger.warn(
        { agentName, errorName: e.name, errorMessage: e.message },
        '[fleet] slack-channels: owner lookup failed (non-fatal); returning channels without ownerSlackId',
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
    // ender-stack#274: redact the raw AWS SDK error name from the
    // client-facing body (logged above for operators).
    return NextResponse.json(
      upstreamErrorBody() satisfies SlackChannelsErrorResponse,
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
        // #501: undefined when the agent has no usable owner — omitted
        // from the JSON by satisfies/serialization, picker treats it as
        // "no owner to prefill".
        ownerSlackId,
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
    // ender-stack#274: redact RAW AWS SDK error names from the client-facing
    // body — echoing e.g. AccessDeniedException / ThrottlingException leaks
    // internal AWS/IAM topology. The slack-client wrapper's own safe,
    // already-sanitized classes (SlackNetworkError, SlackUnknownError, and
    // any other Slack-prefixed catch-all the picker UI maps to a state) are
    // preserved — they carry no AWS internals. The real name is logged via
    // logger.error above either way.
    const safeName =
      error.name && error.name.startsWith('Slack')
        ? error.name
        : UPSTREAM_ERROR_CODE
    return NextResponse.json(
      { error: safeName } satisfies SlackChannelsErrorResponse,
      { status: 502, headers: NO_STORE },
    )
  }
}

export interface SlackChannelsUpdateRequest {
  /**
   * Slack channels the agent should subscribe to. Each entry is
   * either a string ID (legacy; treated as `requireMention: true`)
   * or `{ id, requireMention?: boolean }` (#291). Validated
   * against CHANNEL_ID_RE; deduped + capped at MAX_CHANNELS_PER_AGENT;
   * serialized JSON capped at ECS_ENV_VALUE_MAX. Empty array is
   * valid (clears all channel subscriptions).
   */
  channels: ChannelInput[]
}

export interface SlackChannelsUpdateResponse {
  ok: true
  agentName: string
  taskDefinitionArn: string
  /** Operator-visible diff: how many channels are now subscribed. */
  channelCount: number
  /** ECS deployment ID for the new PRIMARY deployment. */
  deploymentId?: string
}

/**
 * PUT /api/fleet/agents/:name/slack/channels — ender-stack#283.
 *
 * Channels-only update: the picker's Save button writes the
 * operator's selection without requiring a re-paste of tokens.
 * Replaces the prior 501 stub.
 *
 * Steps:
 *   1. Auth + agent name validation.
 *   2. Validate request body shape + channel ID format + count
 *      cap + serialized size cap (same rules as POST
 *      /credentials, shared via lib/slack-channel-injection).
 *   3. Confirm target service is MC-managed (two-tag guard).
 *   4. Read live task-def (DescribeTaskDefinition with
 *      include=['TAGS'] — same shape as credentials POST).
 *   5. Mutate INIT container's env block via injectChannelsIntoInit;
 *      gateway's secrets[] entries are preserved automatically
 *      (we only touch the init container).
 *   6. RegisterTaskDefinition with the mutated spec.
 *   7. UpdateService(forceNewDeployment=true).
 *
 * What's NOT done here:
 *   - SM secret reads: the 3 tokens already live in SM (Beat 5b.2
 *     wrote them). Their secrets[] entries on the gateway pass
 *     through unchanged from the live revision. No new IAM grants
 *     needed beyond what Beat 5b.3a already provisioned for
 *     getSlackBotToken.
 *
 * Auth: admin role.
 *
 * Cross-cleanup status (TODO trail from PR #51 round-7):
 *   - Picker's 501 JSX branch + 501-hint test should be removed
 *     in this PR (this handler now returns 200 on success).
 *   - Ghost-selection filter should land in the picker's
 *     fetch-success branch in the same PR (round-5 audit on PR #51).
 */
export async function PUT(
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

  // ender-stack#272: rate-limit this mutating endpoint (the GET picker
  // read is left unthrottled). Short-circuits before any AWS call.
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

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

  // Body parse + shape check.
  let body: SlackChannelsUpdateRequest
  try {
    const raw = (await request.json()) as unknown
    if (
      !raw ||
      typeof raw !== 'object' ||
      !Array.isArray((raw as { channels?: unknown }).channels) ||
      !((raw as { channels: unknown[] }).channels).every(
        (c) =>
          typeof c === 'string' ||
          (c !== null &&
            typeof c === 'object' &&
            typeof (c as { id?: unknown }).id === 'string'),
      )
    ) {
      return NextResponse.json(
        {
          error: 'InvalidRequestShape',
          detail:
            'Body must be { channels: (string | { id: string, requireMention?: boolean })[] }',
        } satisfies SlackChannelsErrorResponse,
        { status: 400, headers: NO_STORE },
      )
    }
    body = raw as SlackChannelsUpdateRequest
  } catch {
    return NextResponse.json(
      {
        error: 'InvalidRequestBody',
        detail: 'Body is not valid JSON',
      } satisfies SlackChannelsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Count cap.
  if (body.channels.length > MAX_CHANNELS_PER_AGENT) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: `channels[] exceeds the ${MAX_CHANNELS_PER_AGENT}-channel cap (got ${body.channels.length}).`,
      } satisfies SlackChannelsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Per-item format check (#291: accepts string OR object form).
  const formatErr = validateChannelInputs(body.channels)
  if (formatErr) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: formatErr,
      } satisfies SlackChannelsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Dedupe + serialize + serialized-size check (#291: emits
  // {channels:[{id,requireMention}]} on the wire).
  const serialized = serializeChannelInputs(body.channels)
  if ('error' in serialized) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: serialized.error,
      } satisfies SlackChannelsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }
  const { json: channelsConfigJson, channels: dedupedChannels } = serialized

  const fleetPrefix = resolveFleetPrefix()
  const clusterName = fleetPrefix.clusterName
  const serviceName = `${fleetPrefix.prefix}-companion-openclaw-${agentName}`

  let newTaskDefArnIfRegistered: string | undefined
  try {
    // Step 1: confirm the target is an MC-managed agent.
    // ender-stack#280: per-call timeout so a stuck ECS call can't hang the request.
    const describe = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName],
            include: ['TAGS'],
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    // ender-stack#281: a non-MISSING failure (e.g. IAM denial) must 502, not
    // fall through to the not-found 404 below. Mirror GET handler's diagnostic.
    const classified = classifyEcsFailures(describe.failures)
    if (classified.missing.length > 0) {
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          failures: classified.missing,
        },
        '[fleet] slack-channels PUT: DescribeServices returned MISSING failures',
      )
    }
    if (classified.hasNonMissing) {
      logger.error(
        {
          cluster: clusterName,
          serviceName,
          denied: classified.denied,
          other: classified.other,
        },
        '[fleet] slack-channels PUT: DescribeServices returned non-MISSING failures (likely IAM denial)',
      )
      return NextResponse.json(upstreamErrorBody(), {
        status: 502,
        headers: NO_STORE,
      })
    }
    const target = describe.services?.[0]
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
      // 404 (not 403) — refuse to confirm existence of non-harness
      // service. Same convention as the other Slack handlers.
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackChannelsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }

    // Step 2: read the live task-def (with TAGS so the new
    // revision preserves Project/Environment/AgentName/etc).
    // Round-1 audits on PR #55 (claude-bot + greptile): an ACTIVE
    // service should always have a taskDefinition ARN, but the
    // ECS Service type models it as optional. A defensive guard
    // surfaces the surprise as a descriptive 502 instead of a
    // generic AWS error from passing undefined to DescribeTaskDef.
    const liveTaskDefArn = target.taskDefinition
    if (!liveTaskDefArn) {
      return NextResponse.json(
        {
          error: 'ServiceTaskDefinitionMissing',
          detail: `Service "${agentName}" is ACTIVE but has no current task definition ARN`,
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    // ender-stack#280: per-call timeout.
    const tdResp = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new DescribeTaskDefinitionCommand({
            taskDefinition: liveTaskDefArn,
            include: ['TAGS'],
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    const td = tdResp.taskDefinition
    const existingTags = tdResp.tags ?? []
    if (!td || !td.containerDefinitions) {
      return NextResponse.json(
        {
          error: 'TaskDefinitionMissing',
          detail: `Could not load task-def for agent "${agentName}"`,
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    // #494: owner-aware primary-channel check. The owner Slack ID
    // lives on the init-config container env (set at create time);
    // we read it from the live task-def just described. A primary
    // channel with no assignedUsers is rejected ONLY when the agent
    // has no owner (init-config auto-injects a valid owner downstream).
    // Validates the DEDUPED payload (`dedupedChannels`) that actually
    // deploys — not the raw request — so a duplicate primary entry
    // whose later occurrence supplies assignedUsers isn't rejected on
    // a stale earlier occurrence (Greptile P2). Runs before
    // RegisterTaskDefinition so a 400 leaves the live task-def untouched.
    const primaryErr = validatePrimaryAssignment(
      dedupedChannels,
      extractOwnerSlackId(td.containerDefinitions),
    )
    if (primaryErr) {
      return NextResponse.json(
        {
          error: 'InvalidChannelList',
          detail: primaryErr,
        } satisfies SlackChannelsErrorResponse,
        { status: 400, headers: NO_STORE },
      )
    }

    // Step 3: mutate the init container's env (preserves the
    // gateway's secrets[] entries automatically since we don't
    // touch that container). Throws TaskDefinitionInitMissing
    // if shape doesn't match — caught below for the 502 path.
    const newContainerDefs = injectChannelsIntoInit(
      td.containerDefinitions,
      channelsConfigJson,
    )

    const tdInput = stripReadOnlyFields({
      ...(td as unknown as Record<string, unknown>),
      containerDefinitions: newContainerDefs,
      tags: existingTags,
    })

    // Step 4: RegisterTaskDefinition + UpdateService.
    // ender-stack#280: per-call timeout (one handle per call).
    const registered = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new RegisterTaskDefinitionCommand(tdInput),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    const newTaskDefArn = registered.taskDefinition?.taskDefinitionArn
    newTaskDefArnIfRegistered = newTaskDefArn
    if (!newTaskDefArn) {
      return NextResponse.json(
        {
          error: 'RegisterTaskDefinitionFailed',
          detail: 'AWS returned no task-def ARN; safe to retry',
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    // ender-stack#280: per-call timeout (separate handle from RegisterTaskDef).
    const updated = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new UpdateServiceCommand({
            cluster: clusterName,
            service: serviceName,
            taskDefinition: newTaskDefArn,
            forceNewDeployment: true,
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()
    const deploymentId = updated.service?.deployments?.find(
      (d) => d.status === 'PRIMARY',
    )?.id

    // Persist the channel config to SSM AFTER UpdateService succeeds
    // so Terraform only sees configs that actually deployed
    // (ender-stack#470 / #473). Greptile PR #77 P1: if SSM were written
    // before UpdateService and UpdateService later failed, the next
    // `terraform apply` would deploy channel config from an operation
    // MC reported as failed — confusing for the operator and a real
    // safety regression vs the pre-bridge "re-paste to retry" model.
    //
    // Best-effort: failure here doesn't fail the operation — the
    // task-def revision + UpdateService already rolled the agent onto
    // the new config; only drift-resistance on the NEXT `terraform
    // apply` is degraded. Recovery: re-paste to re-arm.
    await writeSlackChannelConfigToSsm({
      projectName: fleetPrefix.projectName,
      environment: fleetPrefix.environment,
      agentName,
      channelsConfigJson,
    })

    // Round-1 audit on PR #55 (pr-agent): isolate audit-log
    // failures from the response. logSecurityEvent calls
    // db.prepare().run() which can throw on SQLite errors (disk
    // full, lock contention). Without this guard, a successful
    // UpdateService followed by a failing audit-log write would
    // surface as a 502 with dangling-revision detail — misleading
    // because the service was already updated. Best-effort log;
    // a missing audit row is preferable to a wrong response.
    try {
      logSecurityEvent({
        event_type: 'fleet.slack-channels.updated',
        severity: 'info',
        source: 'fleet',
        agent_name: agentName,
        detail: `actor=${auth.user.id} channels=${dedupedChannels.length} taskDef=${newTaskDefArn}`,
      })
    } catch (logErr) {
      logger.error(
        {
          agentName,
          newTaskDefArn,
          errorName: (logErr as Error).name,
          errorMessage: (logErr as Error).message,
        },
        '[fleet] slack-channels PUT: audit-log write failed after successful deploy (response unaffected)',
      )
    }

    return NextResponse.json(
      {
        ok: true,
        agentName,
        taskDefinitionArn: newTaskDefArn,
        channelCount: dedupedChannels.length,
        deploymentId,
      } satisfies SlackChannelsUpdateResponse,
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
      '[fleet] slack-channels PUT: AWS error',
    )

    // Round-2 audit on PR #55 (claude-bot): same isolation as
    // the success path — an unguarded throw here would produce
    // a framework 500 (no Cache-Control: no-store, no
    // dangling-revision detail) instead of the structured 502.
    try {
      logSecurityEvent({
        event_type: 'fleet.slack-channels.update-failed',
        severity:
          error.name === 'AccessDeniedException' ? 'warning' : 'info',
        source: 'fleet',
        agent_name: agentName,
        detail: `actor=${auth.user.id} error=${error.name ?? 'AWSError'} taskDefRegistered=${newTaskDefArnIfRegistered ? 'yes' : 'no'}`,
      })
    } catch (logErr) {
      logger.error(
        {
          agentName,
          errorName: (logErr as Error).name,
          errorMessage: (logErr as Error).message,
        },
        '[fleet] slack-channels PUT: failure-audit-log write failed',
      )
    }

    if (error.name === 'TaskDefinitionInitMissing') {
      return NextResponse.json(
        {
          error: 'TaskDefinitionInitMissing',
          detail:
            "Non-retriable: the task-def has no 'init-config' container. " +
            'Check container names in templates/openclaw.ts vs. the registered task-def. ' +
            'No secrets or config were modified.',
        } satisfies SlackChannelsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    let detail: string | undefined
    if (newTaskDefArnIfRegistered) {
      detail = `A new task-def revision was registered (${newTaskDefArnIfRegistered}) but UpdateService failed; a retry will register another revision. The dangling revision is harmless but can be deregistered manually if desired.`
    }
    // ender-stack#274: redact raw AWS error name from the client-facing
    // body. The real name is logged via logger.error above; the
    // dangling-revision detail (operator-actionable, no AWS internals) is
    // preserved.
    return NextResponse.json(
      {
        ...upstreamErrorBody(),
        ...(detail ? { detail } : {}),
      } satisfies SlackChannelsErrorResponse,
      { status: 502, headers: NO_STORE },
    )
  }
}
