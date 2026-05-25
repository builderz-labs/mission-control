import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  AGENT_NAME_MIN_LENGTH,
  HARNESS_TYPES,
  PREFIX_TOO_LONG_ERROR,
  type HarnessType,
} from '@/extensions/fleet/templates/constraints'
import { maxAgentNameLengthForPrefix } from '@/extensions/fleet/templates/openclaw'
import {
  resolveFleetPrefix,
  type FleetPrefix,
} from '@/extensions/fleet/lib/fleet-prefix'
import { withTimeout } from '@/extensions/fleet/lib/aws-hardening'

/**
 * GET /api/fleet/harness-defaults — per-harness defaults the
 * create-agent form pre-fills.
 *
 * Phase 2.2 Beat 3b.1. Today the only field with a useful default is
 * `image` (operators were retyping the OpenClaw image URI from
 * memory). We derive the default by looking up an existing companion-
 * service's currently-deployed image — self-updating as the cluster
 * gets newer images, no env-var or hardcoded sha required.
 *
 * For `companion/openclaw`:
 *   1. List companion-openclaw-* services (via cached services-API
 *      pattern would be ideal, but for a low-volume admin endpoint a
 *      direct DescribeServices is fine).
 *   2. Pick the smoke-test service if present (canonical reference).
 *   3. Read its task-def → return the gateway container's image as
 *      the default.
 *   4. If none of the lookups succeed, return `defaultImage: null` —
 *      form falls back to an example placeholder. Endpoint never 5xx
 *      on a missing default; that would block the form.
 *
 * Auth: `viewer` (matches services.ts) — anyone who can view the
 * Fleet panel can see what the defaults would be.
 *
 * Cache-friendly: defaults change rarely (only when ECS rolls). Form
 * fetches once on mount; no polling.
 */

interface HarnessDefault {
  /** Pre-fill value for the create-agent form's image field; null when unknown. */
  defaultImage: string | null
  /**
   * Maximum legal `agentName` length for THIS deployment, when the
   * harness has a per-deployment cap that's tighter than the
   * AGENT_NAME_RE regex max. Computed server-side from the actual
   * `{prefix}` so the form's input `maxLength` is accurate
   * per-deployment.
   *
   * Optional because not every harness has this constraint — it's
   * specifically driven by the AWS ELBv2 target-group-name 32-char
   * limit, which only applies to ALB-attached harnesses (OpenClaw
   * companion shape). When omitted, the form falls back to the
   * regex max (AGENT_NAME_RE upper bound). Future harnesses that
   * use a different routing primitive (e.g. a Hermes worker
   * triggered by EventBridge → no ALB → no TG-name limit) should
   * leave this undefined.
   *
   * For OpenClaw: derived from the AWS target-group-name 32-char
   * limit minus the `{prefix}-agent-` overhead. See
   * `maxAgentNameLengthForPrefix` in templates/openclaw.ts.
   *
   * Round-8 audit on PR #39 made this optional to avoid forcing
   * future-harness implementers to reverse-engineer an OpenClaw-
   * specific constraint.
   */
  agentNameMaxLength?: number
}

export interface HarnessDefaultsResponse {
  defaults: Record<HarnessType, HarnessDefault>
}

export interface HarnessDefaultsErrorResponse {
  error: string
  /** Operator-actionable detail. The endpoint requires `viewer`
   *  role (any authenticated MC user), so anything reflected in
   *  `detail` is visible to all viewers — keep it to non-secret
   *  config (the deployment prefix qualifies; secret values must
   *  never land here). For PrefixTooLongForHarness: names the
   *  offending prefix so operators without log access can
   *  self-diagnose. Round-8 audit clarified the auth scope. */
  detail?: string
}

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })

// Per-call timeout for the two ECS lookups. Form is operator-facing;
// a stuck handler would block the form's pre-fill effect with no
// error visible to the operator (catch is silent by design — falls
// back to placeholder example). withTimeout + ECS_CALL_TIMEOUT_MS now
// live in lib/aws-hardening.ts, shared with every other fleet handler
// (ender-stack#280).

// Cluster + project/env/prefix derivation shared with agents.ts via
// `lib/fleet-prefix.ts`. Round-7 audit on PR #39 caught the prior
// duplicate logic as a drift risk — extracted so future fallback
// additions land in one place.

/**
 * Lookup the OpenClaw smoke-test service's currently-deployed image.
 * Returns null on any lookup failure (service missing, AWS error,
 * task-def missing the gateway container) — caller treats null as
 * "no default known."
 */
async function openclawDefaultImage(
  fleet: FleetPrefix,
): Promise<string | null> {
  const cluster = fleet.clusterName
  const serviceName = `${fleet.prefix}-companion-openclaw-smoke-test`

  let taskDefArn: string | undefined
  const t1 = withTimeout()
  try {
    const resp = await ecsClient.send(
      new DescribeServicesCommand({
        cluster,
        services: [serviceName],
      }),
      { abortSignal: t1.signal },
    )
    // Filter to ACTIVE only — DescribeServices returns DRAINING +
    // INACTIVE records too, with their last-known taskDefinition.
    // A torn-down smoke-test would otherwise pre-fill a stale image
    // (the operator sees a sha that's no longer running anywhere).
    // Round-1 audit on PR #38 (Greptile P2).
    const activeService = resp.services?.find((s) => s.status === 'ACTIVE')
    taskDefArn = activeService?.taskDefinition
  } catch (err) {
    logger.warn(
      { err, cluster, serviceName },
      '[fleet] harness-defaults: DescribeServices failed; falling back to null default',
    )
    return null
  } finally {
    t1.clear()
  }

  if (!taskDefArn) {
    // Service doesn't exist OR is in DRAINING/INACTIVE state. Either
    // way, no current default to surface — operator gets placeholder.
    return null
  }

  const t2 = withTimeout()
  try {
    const tdResp = await ecsClient.send(
      new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn }),
      { abortSignal: t2.signal },
    )
    const gateway = tdResp.taskDefinition?.containerDefinitions?.find(
      (c) => c.name === 'openclaw-gateway',
    )
    return gateway?.image ?? null
  } catch (err) {
    logger.warn(
      { err, taskDefArn },
      '[fleet] harness-defaults: DescribeTaskDefinition failed; falling back to null default',
    )
    return null
  } finally {
    t2.clear()
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Per-harness lookup. Today only OpenClaw; structured as a record
  // keyed by HARNESS_TYPES so adding Hermes (or any other harness)
  // is a single-line extension.
  const fleet = resolveFleetPrefix()
  const prefix = fleet.prefix

  // Defensive: catch the degenerate case where the deployment
  // prefix is so long that no legal agent name fits under the AWS
  // 32-char target-group-name limit. Threshold is `<
  // AGENT_NAME_MIN_LENGTH` (not `<= 0`) — round-4 audit caught that
  // a 23-24 char prefix produces maxLen=1 or 2, which passes a
  // `<= 0` guard but is structurally impossible (regex min is 3).
  // Form would silently fall back to maxLength=32 and every submit
  // would 400 with a confusing AGENT_NAME_RE rejection. Surface the
  // misconfig at the endpoint instead.
  //
  // TODO(harness-2): this guard is OpenClaw-specific (TG-name limit)
  // but short-circuits the entire endpoint. When HARNESS_TYPES gains
  // a harness without an ALB target group (e.g. EventBridge worker),
  // move this check inside the per-harness defaults block and surface
  // as a per-harness `constraintError` field rather than a top-level
  // 500. Tracking: stroupaloop/ender-stack#243.
  const openclawMaxLen = maxAgentNameLengthForPrefix(prefix)
  if (openclawMaxLen < AGENT_NAME_MIN_LENGTH) {
    logger.error(
      { prefix, openclawMaxLen, minRequired: AGENT_NAME_MIN_LENGTH },
      '[fleet] harness-defaults: deployment prefix leaves insufficient room for any legal agent name (computed max < regex min)',
    )
    return NextResponse.json(
      {
        error: PREFIX_TOO_LONG_ERROR,
        // Surface prefix in detail so operators without log access
        // can self-diagnose. Viewer-role endpoint (matches the
        // `requireRole(request, 'viewer')` check above and the
        // JSDoc on HarnessDefaultsErrorResponse.detail); reflected
        // value is server config, not user input. Round-4 audit
        // added; round-12 corrected "Admin-only" → "viewer-role".
        detail: `prefix "${prefix}" leaves only ${openclawMaxLen} chars for the agent-name segment, but agent names require at least ${AGENT_NAME_MIN_LENGTH}`,
      } satisfies HarnessDefaultsErrorResponse,
      { status: 500 },
    )
  }

  const defaults: Record<HarnessType, HarnessDefault> = {
    'companion/openclaw': {
      defaultImage: await openclawDefaultImage(fleet),
      agentNameMaxLength: openclawMaxLen,
    },
  }

  // Belt-and-suspenders: if HARNESS_TYPES grows but the lookup map
  // doesn't, the response is incomplete. Validate at runtime so the
  // mismatch surfaces in a CI test rather than as a silent UI gap.
  for (const t of HARNESS_TYPES) {
    if (!(t in defaults)) {
      logger.error(
        { harnessType: t },
        '[fleet] harness-defaults: HARNESS_TYPES contains a harness not present in the defaults lookup map',
      )
      return NextResponse.json(
        { error: 'IncompleteDefaults' } satisfies HarnessDefaultsErrorResponse,
        { status: 500 },
      )
    }
  }

  return NextResponse.json(
    { defaults } satisfies HarnessDefaultsResponse,
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
