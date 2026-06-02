import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
  type ContainerDefinition,
  type RegisterTaskDefinitionCommandInput,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  withTimeout,
  upstreamErrorBody,
  classifyEcsFailures,
} from '@/extensions/fleet/lib/aws-hardening'
import { AGENT_NAME_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import {
  writeSlackSecrets,
  requireSecretsPrefix,
  type SlackSecretArns,
} from '@/extensions/fleet/lib/secrets-manager'
import { writeSlackChannelConfigToSsm } from '@/extensions/fleet/lib/slack-ssm-bridge'

/**
 * POST /api/fleet/agents/:name/slack/credentials — Phase 2.4 Beat 5b.2.
 *
 * Operator-driven credential paste. Steps:
 *   1. Validate three Slack token shapes (xapp- app-level, xoxb-
 *      bot, signing secret).
 *   2. Confirm the target agent exists and is MC-managed (two-tag
 *      guard via lib/ecs-guards).
 *   3. Write the three secrets into AWS Secrets Manager via the
 *      Put-or-Create idempotent wrapper.
 *   4. Read the agent's live task-def (DescribeTaskDefinition).
 *   5. Mutate two containers in-place (split per ender-stack#286):
 *      - **gateway**: add 3 secrets[] entries pointing at the SM
 *        ARNs from step 3 (the runtime Slack plugin reads tokens
 *        via process.env.SLACK_*).
 *      - **init-config**: add OPENCLAW_SLACK_CONFIG_JSON to the env
 *        block (init-config.sh consumes it once at boot to template
 *        openclaw.json into the EFS config mount; the gateway then
 *        reads the rendered file).
 *      Channel list never reaches the gateway env; secret values
 *      never reach the init container. Each mutation throws a
 *      distinct error if its target container is missing
 *      (TaskDefinitionGatewayMissing / TaskDefinitionInitMissing).
 *   6. RegisterTaskDefinition with the mutated spec → new revision.
 *   7. UpdateService(forceNewDeployment=true, taskDefinition=newArn)
 *      → ECS rolls the agent onto the new task-def.
 *
 * Returns 200 with the new task-def ARN + deployment ID. Agent
 * picks up the secrets at task-launch (ECS resolves valueFrom on
 * the execution role's GetSecretValue grant — already provisioned
 * by Beat 5a's `mc_agent_shared_execution` policy).
 *
 * Auth: admin. Tied to `MC_AGENT_SECRETS_NAME_PREFIX` — fails fast
 * with ConfigurationError if unset.
 *
 * Idempotency: re-pasting the same tokens is a no-op (PutSecretValue
 * + new task-def revision); operator can rotate by re-pasting new
 * tokens — same flow. The new task-def revision triggers a rolling
 * redeploy regardless (force=true).
 *
 * Channels: optional `channels` field on the request body. When
 * present, encoded into `OPENCLAW_SLACK_CONFIG_JSON` and templated
 * into openclaw.json by the init-config script (Beat 5d). When
 * empty/absent, the agent boots with no Slack channels configured
 * (still functional via DMs once Socket Mode connects).
 */

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })

// ender-stack#278: NO_STORE applied to every response (success
// AND error). Pre-fix only the 200 path had Cache-Control. A
// caching reverse proxy (CloudFront, nginx) caching a transient
// 502 from this credentials endpoint could mislead the operator
// into thinking re-paste is broken when actually the 502 was
// transient. Same shape as PR #50's slack-channels.ts fix.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

// ender-stack#274: app-defined, non-retriable error names that the
// operator-facing `detail` string is keyed to (gateway/init-config
// missing, missing-ARN guards). These are intentional known-name
// handling and pass through to the client verbatim; every other
// (raw AWS SDK) name is redacted to UPSTREAM_ERROR_CODE. Module-level
// so it isn't re-allocated on each error.
const CLIENT_SAFE_ERROR_NAMES = new Set([
  'TaskDefinitionGatewayMissing',
  'TaskDefinitionInitMissing',
  'PutSecretValueMissingArn',
  'CreateSecretMissingArn',
  'RegisterTaskDefinitionMissingArn',
])

const GATEWAY_CONTAINER_NAME = 'gateway'
// ender-stack#286: OPENCLAW_SLACK_CONFIG_JSON is consumed by
// init-config.sh inside the INIT container — gateway reads
// the rendered openclaw.json from the EFS config mount, not
// from process.env. Inject the channel-config env on init.
// Secrets stay on gateway because the runtime plugin reads
// SLACK_APP_TOKEN / SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET
// from process.env at task-launch via the gateway's own
// secrets[] entries (Beat 5a IAM grants).
//
// ender-stack#283 extracted the channel-injection helpers into
// a shared module so both this credentials POST handler and
// the channels-only PUT handler use the same code path. The
// constants below are re-imported (rather than duplicated)
// from that module to keep validation rules in lock-step.
import {
  CHANNEL_ID_RE,
  ECS_ENV_VALUE_MAX,
  INIT_CONTAINER_NAME,
  MAX_CHANNELS_PER_AGENT,
  SLACK_CONFIG_ENV_NAME,
  extractOwnerSlackId,
  injectChannelsIntoInit,
  serializeChannelInputs,
  validateAtLeastOneAllowlisted,
  validateChannelInputs,
  validatePrimaryAssignment,
  type ChannelInput,
} from '@/extensions/fleet/lib/slack-channel-injection'
import { stripReadOnlyFields } from '@/extensions/fleet/lib/ecs-task-def-helpers'

const SLACK_APP_TOKEN_ENV = 'SLACK_APP_TOKEN'
const SLACK_BOT_TOKEN_ENV = 'SLACK_BOT_TOKEN'
const SLACK_SIGNING_SECRET_ENV = 'SLACK_SIGNING_SECRET'

// Token shape regexes — prefix-anchored. Full Slack token format is
// not publicly stable enough for tight regex; the prefix check
// rejects obvious garbage (e.g., the operator pastes "xapp-…" into
// the bot-token field). The IAM + Slack-side rejection handle the
// rest if a malformed value slips through.
//
// Round-1 audit on PR #48: app-id middle segments may have mixed
// case in some Slack workspace configurations — relaxed to
// [A-Za-z0-9]+ to match the "not publicly stable" framing.
// Round-3 audit on PR #51 extracted the three regexes into a
// shared module so client-side validation in
// slack-credentials-form.tsx imports the same patterns the
// server enforces. Eliminates silent drift on revisions.
import {
  APP_TOKEN_RE,
  BOT_TOKEN_RE,
  SIGNING_SECRET_RE,
  TOKEN_MAX_LENGTH,
} from '@/extensions/fleet/lib/slack-token-patterns'
// BOT_TOKEN_RE / SIGNING_SECRET_RE — see
// `src/extensions/fleet/lib/slack-token-patterns.ts` for the
// regex definitions and revision history (rounds 1 + 6 on
// PR #48). Imported above; this comment block kept as a
// forwarding reference so a future revision starts at the
// shared module.

// MAX_CHANNELS_PER_AGENT, CHANNEL_ID_RE, validateChannelIds,
// ECS_ENV_VALUE_MAX, INIT_CONTAINER_NAME, SLACK_CONFIG_ENV_NAME,
// injectChannelsIntoInit, serializeChannels — all imported from
// `lib/slack-channel-injection.ts` above. ender-stack#283 moved
// them out of this file so the channels-only PUT handler can
// share the same validation + injection code path.

export interface SlackCredentialsRequest {
  appToken: string
  botToken: string
  signingSecret: string
  /**
   * Optional list of Slack channels the agent should subscribe to.
   * Each entry is either a string ID (legacy; treated as
   * `requireMention: true`) or `{ id, requireMention?: boolean }`
   * (#291). Encoded into OPENCLAW_SLACK_CONFIG_JSON; init-config
   * templates them into openclaw.json's `channels.slack.channels`
   * block. Empty array means agent boots with no channels
   * configured (still works for DMs via Socket Mode).
   */
  channels?: ChannelInput[]
}

export interface SlackCredentialsResponse {
  ok: true
  agentName: string
  taskDefinitionArn: string
  /** ECS deployment ID for the new PRIMARY deployment. Useful for cross-referencing CloudTrail. */
  deploymentId?: string
  /** ARNs of the three secrets written. Surfaced for operator visibility / audit. */
  secretArns: SlackSecretArns
}

export interface SlackCredentialsErrorResponse {
  error: string
  detail?: string
  /** Field-level validation errors when error === 'InvalidRequestShape'. */
  fieldErrors?: Record<string, string>
}

function isCredentialsRequest(
  body: unknown,
): body is SlackCredentialsRequest {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.appToken !== 'string') return false
  if (typeof b.botToken !== 'string') return false
  if (typeof b.signingSecret !== 'string') return false
  if (b.channels !== undefined) {
    if (!Array.isArray(b.channels)) return false
    // #291: each entry is either a string ID or { id, requireMention? }.
    if (
      !b.channels.every(
        (c) =>
          typeof c === 'string' ||
          (c !== null &&
            typeof c === 'object' &&
            typeof (c as { id?: unknown }).id === 'string'),
      )
    )
      return false
  }
  return true
}

/**
 * Validate token shapes after the type guard. Returns a per-field
 * error map; empty map means all tokens passed. Surface shape errors
 * back to the operator so they can fix the paste; without this the
 * Slack API would return a confusing AuthenticationError on first
 * Socket Mode connect attempt.
 */
function validateTokenShapes(
  req: SlackCredentialsRequest,
): Record<string, string> {
  const errs: Record<string, string> = {}
  // ender-stack#275: length guard before the regex test. A
  // multi-MB string that happens to match `xapp-1-` would pass
  // the regex's `+` quantifier, reach PutSecretValueCommand,
  // and 400 at SM's 64KB limit — surfacing as a misleading 502
  // "retry is safe" instead of a clean 400 "your paste is bad."
  if (req.appToken.length > TOKEN_MAX_LENGTH) {
    errs.appToken = `App-level token exceeds ${TOKEN_MAX_LENGTH}-char limit (got ${req.appToken.length})`
  } else if (!APP_TOKEN_RE.test(req.appToken)) {
    errs.appToken = 'Expected `xapp-1-...` app-level token (Socket Mode)'
  }
  if (req.botToken.length > TOKEN_MAX_LENGTH) {
    errs.botToken = `Bot token exceeds ${TOKEN_MAX_LENGTH}-char limit (got ${req.botToken.length})`
  } else if (!BOT_TOKEN_RE.test(req.botToken)) {
    errs.botToken = 'Expected `xoxb-...` bot user OAuth token'
  }
  if (req.signingSecret.length > TOKEN_MAX_LENGTH) {
    errs.signingSecret = `Signing secret exceeds ${TOKEN_MAX_LENGTH}-char limit (got ${req.signingSecret.length})`
  } else if (!SIGNING_SECRET_RE.test(req.signingSecret)) {
    errs.signingSecret =
      'Expected exactly 32 lowercase hex chars (Slack signing secret)'
  }
  return errs
}

// CHANNEL_ID_RE + validateChannelIds — see
// `lib/slack-channel-injection.ts`. Imported above; this
// comment is a forwarding reference.

// stripReadOnlyFields — see lib/ecs-task-def-helpers.ts.
// Extracted on ender-stack#283 so the channels-only PUT handler
// can share the same logic.

/**
 * Mutate the gateway container in-place: add the 3 SM-resolved
 * secrets[] entries (SLACK_APP_TOKEN / SLACK_BOT_TOKEN /
 * SLACK_SIGNING_SECRET → SM ARNs).
 *
 * ender-stack#286: previously this also injected
 * OPENCLAW_SLACK_CONFIG_JSON onto the gateway env block —
 * wrong target. The init container is the consumer of the
 * channel-config env (init-config.sh templates openclaw.json
 * from it). Secrets stay here because the runtime plugin in
 * the gateway reads them via process.env.
 *
 * Throws TaskDefinitionGatewayMissing if no container named
 * `gateway` is present — non-retriable, operator must verify
 * container naming in templates/openclaw.ts.
 */
function injectSecretsIntoGateway(
  containers: ContainerDefinition[],
  arns: SlackSecretArns,
): ContainerDefinition[] {
  const hasGateway = containers.some((c) => c.name === GATEWAY_CONTAINER_NAME)
  if (!hasGateway) {
    const err = new Error(
      `Task-def has no '${GATEWAY_CONTAINER_NAME}' container — cannot inject Slack secrets. ` +
        `Found containers: [${containers.map((c) => c.name).join(', ')}]. ` +
        `Non-retriable: check container names in templates/openclaw.ts vs. the registered task-def.`,
    )
    err.name = 'TaskDefinitionGatewayMissing'
    throw err
  }
  return containers.map((c) => {
    if (c.name !== GATEWAY_CONTAINER_NAME) return c
    const existingSecrets = (c.secrets ?? []).filter((s) => {
      // Drop existing slack-* entries — re-pasted ARNs supersede.
      return (
        s.name !== SLACK_APP_TOKEN_ENV &&
        s.name !== SLACK_BOT_TOKEN_ENV &&
        s.name !== SLACK_SIGNING_SECRET_ENV
      )
    })
    const slackSecrets = [
      { name: SLACK_APP_TOKEN_ENV, valueFrom: arns.appToken },
      { name: SLACK_BOT_TOKEN_ENV, valueFrom: arns.botToken },
      { name: SLACK_SIGNING_SECRET_ENV, valueFrom: arns.signingSecret },
    ]
    return {
      ...c,
      secrets: [...existingSecrets, ...slackSecrets],
    }
  })
}

// injectChannelsIntoInit — see lib/slack-channel-injection.ts.
// Imported above; this comment is a forwarding reference. Was
// inline here originally; ender-stack#283 extracted it so the
// PUT /channels handler can share the same implementation.

export async function POST(
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

  // ender-stack#272: throttle this mutation endpoint per-IP. Returns a
  // 429 NextResponse when over budget; short-circuit before any AWS work.
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const { name: agentName } = await params

  if (!agentName || !AGENT_NAME_RE.test(agentName)) {
    return NextResponse.json(
      {
        error: 'InvalidAgentName',
        detail: `agentName must match ${AGENT_NAME_RE.source}`,
      } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Fail fast if the deployment isn't wired for credential storage
  // (MC_AGENT_SECRETS_NAME_PREFIX unset). Beat 5a documented this
  // as a startup-assertable invariant; honoring it here rather
  // than letting the SecretsManager call 403/blow up later.
  //
  // Round-1 audit on PR #48: the prefix is asserted here AND read
  // again inside writeSlackSecrets. Since both calls hit the same
  // process.env, this is just a redundant double-read — but the
  // pattern was confusing (`void secretsPrefix` to suppress lint).
  // Calling once and ignoring the value is now the explicit
  // assertion; writeSlackSecrets's own call is a backstop.
  try {
    requireSecretsPrefix()
  } catch (err) {
    return NextResponse.json(
      {
        error: 'ConfigurationError',
        detail: (err as Error).message,
      } satisfies SlackCredentialsErrorResponse,
      { status: 500, headers: NO_STORE },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'InvalidRequestBody' } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }
  if (!isCredentialsRequest(body)) {
    return NextResponse.json(
      { error: 'InvalidRequestShape' } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  const fieldErrors = validateTokenShapes(body)
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      {
        error: 'InvalidTokenShape',
        detail: 'One or more Slack tokens have an unexpected format',
        fieldErrors,
      } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Channel-list length cap — ECS task-def env values are capped at
  // 512 chars; with JSON framing overhead each channel ID adds ~14
  // chars + separators. ~50 channels is the practical ceiling.
  // Bail with a clear 400 so an oversized list doesn't 502 deep
  // inside RegisterTaskDefinition.
  if ((body.channels?.length ?? 0) > MAX_CHANNELS_PER_AGENT) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: `channels[] exceeds the ${MAX_CHANNELS_PER_AGENT}-channel cap (got ${body.channels!.length}). ECS task-def env values cap at 512 chars; reduce the channel count before pasting.`,
      } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Per-item channel ID format check (#291: accepts string OR
  // object form). Protects against arbitrary long strings
  // inflating OPENCLAW_SLACK_CONFIG_JSON past the ECS 512-char
  // env-value cap even within the 50-item count cap.
  const channelErr = validateChannelInputs(body.channels)
  if (channelErr) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: channelErr,
      } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }

  // Dedupe + normalize + serialize via shared helper (#291).
  // Emits {channels:[{id,requireMention}]} on the wire.
  const serialized = serializeChannelInputs(body.channels)
  if ('error' in serialized) {
    return NextResponse.json(
      {
        error: 'InvalidChannelList',
        detail: serialized.error,
      } satisfies SlackCredentialsErrorResponse,
      { status: 400, headers: NO_STORE },
    )
  }
  const { json: channelsConfigJson, channels: dedupedChannels } = serialized

  const fleetPrefix = resolveFleetPrefix()
  const clusterName = fleetPrefix.clusterName
  const serviceName = `${fleetPrefix.prefix}-companion-openclaw-${agentName}`

  // Track whether ANY secret-write attempts have started. Round-2
  // audit on PR #48 flipped this from "all 3 succeeded" to
  // "attempted at all" — putOrCreateSecret is idempotent, so
  // retrying after a partial failure (1 of 3 SM writes failed) is
  // also safe. The hint should fire for any post-write-attempt
  // failure, not just post-all-3-succeeded. Track a flag set
  // BEFORE Promise.all so partial-success still surfaces "retry
  // is safe."
  //
  // Track separately whether a NEW task-def revision was already
  // registered. If RegisterTaskDef succeeded but UpdateService
  // failed, a re-paste registers another revision; the operator
  // should know the prior revision is dangling so they can
  // optionally clean up via the deregister-task-definition path.
  let secretsAttempted = false
  let newTaskDefArnIfRegistered: string | undefined

  try {
    // ================================================================
    // Step 1: Confirm agent exists + is MC-managed
    // ================================================================
    // ender-stack#280: bound every AWS SDK call with a per-call timeout
    // so a stuck send() can't hang the request indefinitely.
    const describeSvcTimeout = withTimeout()
    let describeSvc
    try {
      describeSvc = await ecsClient.send(
        new DescribeServicesCommand({
          cluster: clusterName,
          services: [serviceName],
          include: ['TAGS'],
        }),
        { abortSignal: describeSvcTimeout.signal },
      )
    } finally {
      describeSvcTimeout.clear()
    }
    // ender-stack#281: a non-MISSING describe failure (IAM denial /
    // transient ECS fault, no service object) must surface as a 502
    // rather than be reported as not-found below.
    const classifiedSvc = classifyEcsFailures(describeSvc.failures)
    if (classifiedSvc.hasNonMissing) {
      logger.error(
        {
          cluster: clusterName,
          serviceName,
          agentName,
          denied: classifiedSvc.denied,
          other: classifiedSvc.other,
        },
        '[fleet] slack-credentials: DescribeServices returned non-MISSING failures (likely IAM denial)',
      )
      return NextResponse.json(
        upstreamErrorBody() satisfies SlackCredentialsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }
    const target = describeSvc.services?.[0]
    // Round-2 audit on PR #48: tighten from "INACTIVE only" to
    // "anything other than ACTIVE" — DRAINING services (mid-stop,
    // mid-deploy) shouldn't accept new credentials. ECS service
    // states: ACTIVE, INACTIVE, DRAINING. Only ACTIVE is a stable
    // state where mutating the task-def is safe.
    if (!target || target.status !== 'ACTIVE') {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found or not in ACTIVE state`,
        } satisfies SlackCredentialsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
    if (!isAgentHarness(target)) {
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies SlackCredentialsErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
    const currentTaskDefArn = target.taskDefinition
    if (!currentTaskDefArn) {
      // Defensive: an ACTIVE service without a task-def ARN is
      // a broken state we shouldn't try to mutate from. Surface as
      // 502 so the operator knows to investigate (probably needs a
      // describe-tasks to figure out what's going on).
      return NextResponse.json(
        {
          error: 'ServiceMissingTaskDefinition',
          detail: `service ${serviceName} is ACTIVE but has no taskDefinition`,
        } satisfies SlackCredentialsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    // ================================================================
    // Step 2: Read live task-def (with tags)
    // ================================================================
    // `include: ['TAGS']` is load-bearing — without it
    // DescribeTaskDefinition returns no tags, and the new revision
    // we register would silently lose Project/Environment/AgentName
    // labels. Round-1 audit on PR #48 caught this; the fix is the
    // include hint + reading td.tags below. The tags from this
    // response are returned at the top-level (not nested in
    // taskDefinition), so destructure both.
    //
    // ender-stack#494: this describe runs BEFORE the Secrets Manager
    // write so the owner-aware channel validation below can reject an
    // invalid payload without performing any mutation (pr-agent
    // "partial mutation" finding on PR #86). It's a pure read, so
    // ordering it first is safe; secrets are only written once the
    // full request is known-good.
    const describeTdTimeout = withTimeout()
    let describeTd
    try {
      describeTd = await ecsClient.send(
        new DescribeTaskDefinitionCommand({
          taskDefinition: currentTaskDefArn,
          include: ['TAGS'],
        }),
        { abortSignal: describeTdTimeout.signal },
      )
    } finally {
      describeTdTimeout.clear()
    }
    const td = describeTd.taskDefinition
    const existingTags = describeTd.tags ?? []
    if (!td || !td.containerDefinitions) {
      return NextResponse.json(
        {
          error: 'TaskDefinitionMissing',
          detail: `current task-def ${currentTaskDefArn} returned no containerDefinitions`,
        } satisfies SlackCredentialsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    // ================================================================
    // Step 3: Owner-aware primary-channel validation (#494)
    // ================================================================
    // Owner Slack ID lives on the init-config container env (set at
    // create time); read it from the live task-def just described.
    // Reject a primary channel with no assignedUsers ONLY when the
    // agent has no owner (init-config auto-injects a valid owner
    // downstream). Validates the DEDUPED payload (`dedupedChannels`)
    // that actually deploys — not the raw request — so a duplicate
    // primary entry whose later occurrence supplies assignedUsers
    // isn't rejected on a stale earlier occurrence (Greptile P2).
    // Runs before the secrets write, so a 400 here performs NO
    // mutation at all (pr-agent partial-mutation finding).
    const ownerSlackId = extractOwnerSlackId(td.containerDefinitions)
    const primaryErr = validatePrimaryAssignment(dedupedChannels, ownerSlackId)
    if (primaryErr) {
      return NextResponse.json(
        {
          error: 'InvalidChannelList',
          detail: primaryErr,
        } satisfies SlackCredentialsErrorResponse,
        { status: 400, headers: NO_STORE },
      )
    }

    // ender-stack#549: hard-block a workspace-open config on the
    // direct-API path, symmetric with the picker's PUT /slack/channels
    // guard (#535). When a caller posts a non-empty `channels` list,
    // require ≥1 allowlist-gated channel (a "primary" with the owner
    // auto-included, or an "active" with assignedUsers) so no fresh
    // agent deploys mention-able by any workspace user. Runs after the
    // primary-assignment check (which keeps its own "no usable owner"
    // message) and before the secrets write, so a 400 here performs NO
    // mutation. An empty/absent `channels` list is unaffected — the
    // normal create flow sends none and uses the picker.
    //
    // #286 contract change: callers that posted an all-legacy/all-monitor
    // `channels` array to deploy a workspace-open agent now get a 400.
    // They must include ≥1 gated channel, or omit `channels` and gate
    // via the picker. The init-config workspace-open WARNING + CloudWatch
    // alarm (ender-stack#535/#547) stay as defense-in-depth for any other
    // config-injection path and for runtime visibility.
    const allowlistErr = validateAtLeastOneAllowlisted(
      dedupedChannels,
      ownerSlackId,
    )
    if (allowlistErr) {
      return NextResponse.json(
        {
          error: 'InvalidChannelList',
          detail: allowlistErr,
        } satisfies SlackCredentialsErrorResponse,
        { status: 400, headers: NO_STORE },
      )
    }

    // ================================================================
    // Step 4: Write three Slack secrets to Secrets Manager
    // ================================================================
    secretsAttempted = true
    const arns = await writeSlackSecrets({
      agentName,
      projectName: fleetPrefix.projectName,
      environment: fleetPrefix.environment,
      appToken: body.appToken,
      botToken: body.botToken,
      signingSecret: body.signingSecret,
    })

    // ================================================================
    // Step 5: Mutate containers + register new revision
    // ================================================================
    // channelsConfigJson computed earlier (before AWS calls) so
    // size-cap rejections return 400 instead of 502.
    //
    // ender-stack#286: split the mutation across both containers.
    // Gateway gets the 3 secrets[] entries (runtime plugin reads
    // tokens via process.env); init-config gets the channel
    // config env (templating script reads it to render
    // openclaw.json). Each helper throws a distinct error if its
    // target container is missing.
    const containersWithSecrets = injectSecretsIntoGateway(
      td.containerDefinitions,
      arns,
    )
    const newContainerDefs = injectChannelsIntoInit(
      containersWithSecrets,
      channelsConfigJson,
    )
    const tdInput = stripReadOnlyFields({
      ...(td as unknown as Record<string, unknown>),
      containerDefinitions: newContainerDefs,
      // Preserve the tags from the existing task-def's
      // DescribeTaskDefinition response (read with include=['TAGS']
      // above). Without this, the new revision would drop
      // Project/Environment/AgentName/etc and break the resource-
      // tag-based filtering the rest of the platform depends on.
      tags: existingTags,
    })

    const registerTimeout = withTimeout()
    let registered
    try {
      registered = await ecsClient.send(
        new RegisterTaskDefinitionCommand(tdInput),
        { abortSignal: registerTimeout.signal },
      )
    } finally {
      registerTimeout.clear()
    }
    const newTaskDefArn = registered.taskDefinition?.taskDefinitionArn
    newTaskDefArnIfRegistered = newTaskDefArn
    if (!newTaskDefArn) {
      return NextResponse.json(
        {
          error: 'RegisterTaskDefinitionMissingArn',
          detail: 'AWS returned a successful response with no taskDefinitionArn',
        } satisfies SlackCredentialsErrorResponse,
        { status: 502, headers: NO_STORE },
      )
    }

    // ================================================================
    // Step 5: UpdateService → roll onto the new revision
    // ================================================================
    const updateTimeout = withTimeout()
    let updated
    try {
      updated = await ecsClient.send(
        new UpdateServiceCommand({
          cluster: clusterName,
          service: serviceName,
          taskDefinition: newTaskDefArn,
          forceNewDeployment: true,
        }),
        { abortSignal: updateTimeout.signal },
      )
    } finally {
      updateTimeout.clear()
    }
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
    // task-def revision we registered above + UpdateService already
    // rolled the agent onto the new config; only drift-resistance on
    // the NEXT `terraform apply` is degraded. Recovery: re-paste to
    // re-arm. The IAM grant `task_ssm_slack_config` (ender-stack iam
    // module) is scoped to exactly this path pattern.
    await writeSlackChannelConfigToSsm({
      projectName: fleetPrefix.projectName,
      environment: fleetPrefix.environment,
      agentName,
      channelsConfigJson,
    })

    logSecurityEvent({
      event_type: 'fleet.slack-credentials.updated',
      severity: 'info',
      source: 'fleet',
      agent_name: agentName,
      detail: `actor=${auth.user?.id} taskDef=${newTaskDefArn} channels=${dedupedChannels.length}`,
    })

    return NextResponse.json(
      {
        ok: true,
        agentName,
        taskDefinitionArn: newTaskDefArn,
        deploymentId,
        secretArns: arns,
      } satisfies SlackCredentialsResponse,
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
        secretsAttempted,
        newTaskDefArnIfRegistered,
      },
      '[fleet] slack-credentials: AWS error',
    )
    // Emit a security audit event on failure paths too — round-3
    // audit on PR #48 P2 noted that without this, an attacker
    // probing the endpoint (or an operator repeatedly fat-fingering
    // tokens) leaves zero security audit trail. The success-path
    // event captures normal mutations; this captures everything
    // that DIDN'T succeed. Token values still aren't logged
    // (errorName + errorMessage are the AWS SDK's, no token
    // material).
    logSecurityEvent({
      event_type: 'fleet.slack-credentials.failed',
      severity: 'warning',
      source: 'fleet',
      agent_name: agentName,
      detail:
        `actor=${auth.user?.id} error=${error.name ?? 'AWSError'} ` +
        `secretsAttempted=${secretsAttempted} taskDefRegistered=${newTaskDefArnIfRegistered ? 'yes' : 'no'}`,
    })
    // Hint the operator about retry safety + dangling state.
    // PutSecretValue/CreateSecret are idempotent (round-1 audit
    // pattern), so a retry after ANY secrets-attempted failure is
    // safe. If a task-def was registered but UpdateService failed,
    // call that out so the operator knows the prior revision is
    // dangling (cosmetic — ECS handles million-revision families
    // fine, but tidy operators may want to deregister it).
    //
    // Round-7 audit on PR #48: TaskDefinitionGatewayMissing is a
    // configuration error that NO retry will fix — the gateway
    // container name doesn't match what's in the registered task-
    // def. Without this branch the generic "retry is safe" hint
    // would mislead operators into a retry loop. Emit a distinct
    // non-retriable detail and skip the dangling-revision branch
    // (no task-def is registered when this throws — it fires
    // pre-RegisterTaskDefinition).
    let detail: string | undefined
    if (error.name === 'TaskDefinitionGatewayMissing') {
      // Round-2 audit on PR #52: aligned wording with
      // TaskDefinitionInitMissing for operator clarity. The
      // prior "secrets will be overwritten on next paste"
      // phrasing was vague — both gateway-missing and
      // init-missing throw BEFORE RegisterTaskDefinition, so
      // the live task-def is unchanged in either case.
      detail =
        "Non-retriable: the task-def has no 'gateway' container. " +
        'Check container names in templates/openclaw.ts vs. the registered task-def. ' +
        'Secret values were written to Secrets Manager (idempotent) but the task-def was NOT updated — ' +
        'the gateway will not resolve SLACK_APP_TOKEN / SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET at runtime until a successful paste registers a new revision.'
    } else if (error.name === 'TaskDefinitionInitMissing') {
      // ender-stack#286: same shape as gateway-missing.
      // Channel-config injection target is the init-config
      // container; if it's missing, no retry will fix it
      // until the templates/openclaw.ts container shape is
      // realigned. Secrets may have already been added to
      // the gateway in-memory, but we threw before
      // RegisterTaskDefinition so neither the env nor the
      // secrets[] entries landed on the live task-def.
      //
      // Round-1 audit on PR #52: tightened the detail string
      // from "secrets will be overwritten on next paste" —
      // that wording suggested the gateway was "configured
      // but incomplete," when the actual state is: SM has
      // the secret values, the live task-def has zero
      // references to them.
      detail =
        "Non-retriable: the task-def has no 'init-config' container. " +
        'Check container names in templates/openclaw.ts vs. the registered task-def. ' +
        'Secret values were written to Secrets Manager (idempotent) but the task-def was NOT updated — ' +
        'the gateway will not resolve SLACK_APP_TOKEN / SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET at runtime until a successful paste registers a new revision.'
    } else if (secretsAttempted) {
      detail =
        'Secrets-write was attempted (idempotent); retry is safe.'
      if (newTaskDefArnIfRegistered) {
        detail +=
          ` A new task-def revision was already registered (${newTaskDefArnIfRegistered})` +
          ' but the service update failed; a retry will register another revision.' +
          ' The dangling revision is harmless but can be deregistered manually if desired.'
      }
    }
    // ender-stack#274: redact the raw error name in the client-facing
    // body so raw AWS SDK error names (AccessDeniedException,
    // ThrottlingException, UnrecognizedClientException, ...) never leak
    // internal AWS/IAM topology to the caller. The real name is logged
    // server-side via logger.error above. App-defined, non-retriable
    // names that the operator-facing detail string is keyed to (gateway/
    // init-config missing, missing-ARN guards) are intentional known-name
    // handling and stay verbatim — only the raw AWS fallback is redacted.
    // CLIENT_SAFE_ERROR_NAMES is defined at module scope (see above).
    const clientErrorCode =
      error.name && CLIENT_SAFE_ERROR_NAMES.has(error.name)
        ? error.name
        : upstreamErrorBody().error
    return NextResponse.json(
      {
        error: clientErrorCode,
        ...(detail ? { detail } : {}),
      } satisfies SlackCredentialsErrorResponse,
      { status: 502, headers: NO_STORE },
    )
  }
}
