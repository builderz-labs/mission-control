import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  RegisterTaskDefinitionCommand,
  CreateServiceCommand,
} from '@aws-sdk/client-ecs'
import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  CreateRuleCommand,
  DescribeLoadBalancersCommand,
  DescribeListenersCommand,
  DescribeRulesCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
import {
  HARNESS_TEMPLATES,
  ImageAllowlistConfigError,
  type OpenClawAgentInput,
  type OpenClawAgentEnv,
} from '@/extensions/fleet/templates'
// Constants live in `templates/constraints.ts` (no AWS SDK imports) so
// the client-side form, the per-harness validateInput, AND the
// harness-agnostic type guard below all share the same regex /
// model-tier list. Drift between layers would re-open the gap that
// constraints.ts was created to close.
import {
  AGENT_NAME_RE,
  HARNESS_TYPES,
  type HarnessType,
} from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import {
  getLiteLLMMasterKey,
  writeAgentLiteLLMKey,
  requireSecretsPrefix,
} from '@/extensions/fleet/lib/secrets-manager'
import {
  LiteLLMManagementClient,
  LiteLLMManagementError,
} from '@/extensions/litellm/management'

/**
 * Per-agent LiteLLM virtual-key defaults (#354). Hardcoded for now;
 * the parent issue (#326 Track 2) anticipates per-agent overrides via
 * the create-agent request body once the Beat 3b form has surfaced
 * the right operator-facing controls. Filed as a follow-up.
 *
 * Must be a SUPERSET of every model referenced by ender-stack's
 * init-config.sh (`modelsAllowlist`, `primaryFallbacks`,
 * `subagents.model`, `imageModel`, `pdfModel`, `compaction.model`).
 * Keep in lock-step with both:
 *   - ender-stack/services/companion/openclaw/init/init-config.sh
 *   - services/litellm/config/litellm-config.aws.yaml
 *
 * Two failure modes covered by the entries below:
 *   1. Allowlist drift — a model listed in init-config's fallback
 *      chain but missing here silently 403s MC-created agents while
 *      smoke-test agents (master-key) still hit it.
 *   2. Prefix-stripping — OpenClaw sends the model field WITHOUT the
 *      `provider/` prefix, and LiteLLM's key auth does exact string
 *      match (see auth_checks.py:_check_model_access_helper), so
 *      every model is enumerated in both `provider/name` and bare
 *      `name` form. Until OpenClaw is patched upstream to forward
 *      the prefixed form (or LiteLLM gains prefix-aware matching),
 *      both variants must be present. Tracked: ender-stack#367
 *      (workaround removal contract).
 *
 * Drift between this list and init-config is asserted in the
 * `DEFAULT_LITELLM_MODEL_ALLOWLIST drift detection` test in
 * agents-create.test.ts. See ender-stack#365 for the incident.
 */
export const DEFAULT_LITELLM_MODEL_ALLOWLIST: string[] = [
  // Smart router (primary)
  'openai/smart-router', 'smart-router',
  // Anthropic
  'anthropic/claude-opus-4-6',   'claude-opus-4-6',
  'anthropic/claude-opus-4-7',   'claude-opus-4-7',
  'anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',  'claude-haiku-4-5',
  // OpenAI
  'openai/gpt-5.5',      'gpt-5.5',
  'openai/gpt-5.4',      'gpt-5.4',
  'openai/gpt-5.4-mini', 'gpt-5.4-mini',
  'openai/gpt-5.4-nano', 'gpt-5.4-nano',
  'openai/o3',           'o3',
  // Google
  'google/gemini-3.1-pro-preview', 'gemini-3.1-pro-preview',
  'google/gemini-3-flash',         'gemini-3-flash',
  // xAI
  'xai/grok-4-1-fast-reasoning', 'grok-4-1-fast-reasoning',
  // Perplexity
  'perplexity/sonar',     'sonar',
  'perplexity/sonar-pro', 'sonar-pro',
]
const DEFAULT_LITELLM_MAX_BUDGET_USD = 50

/**
 * POST /api/fleet/agents — create a new MC-managed agent end-to-end.
 *
 * Phase 2.2 Beat 3a (backend). Orchestrates the full ECS + ELBv2
 * create-agent flow: register task-def → create CW log group →
 * create target group → create listener rule → create service.
 *
 * Auth: `admin` role required. Phase 2.1 Redeploy was `operator` (lower
 * blast radius — kicks existing config). Create is permanent +
 * irreversible at the IAM grant boundary, so it sits one tier higher.
 *
 * Hybrid source-of-truth boundary:
 *   Terraform owns: ECS cluster, IAM roles, shared agents ALB +
 *     listener (ender-stack/terraform/modules/agents-shared-alb),
 *     shared OpenClaw task + exec roles (ender-stack #210, follow-up).
 *   This handler owns: per-agent task-def + service + target group +
 *     listener rule + CW log group, all created via runtime API calls.
 *     None of these resources land in Terraform state.
 *
 * Idempotency:
 *   The handler is NOT idempotent today — calling it twice with the same
 *   agent name returns a 409 (conflict) on the second call because the
 *   ECS service already exists. Reconciliation across MC SQLite ↔ ECS is
 *   deferred to Beat 3c (the scheduled reconciler).
 *
 * Validation:
 *   `agentName` must match `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` (length
 *   3-32, alphanumeric start AND end — no leading or trailing
 *   hyphens). Digit-start is permitted; AWS doesn't require
 *   letter-start for any of the resources MC creates. The IAM policy
 *   doc for `task_ecs_write`
 *   (ender-stack PR #208) explicitly cites this regex as load-bearing
 *   — `ecs:RegisterTaskDefinition` is granted Resource:"*" because the
 *   AWS verb has no resource-level auth, so this regex is the only
 *   thing keeping a compromised request from registering a task-def
 *   with an arbitrary family name (e.g., overwriting `litellm`). Treat
 *   it accordingly: it's a security control, not a UX nicety.
 *
 * Error response shape:
 *   - **AWS-SDK errors (5xx + 4xx-on-AWS)**: only the SDK `error.name`
 *     surfaces — no `detail` — so IAM ARNs / account IDs stay out of
 *     the browser. Full stack stays in CloudWatch via logger.error.
 *   - **`ValidationError` (400) and `ConfigurationError` (500)**:
 *     intentionally include a `detail` field. The values that surface
 *     are either the operator's own input (echoed back so they can
 *     fix it) or the misconfigured env-var name + its bad value (so
 *     the operator knows what to fix in their deployment). Both
 *     paths are admin-only; the reflected content is the admin's own
 *     input or their own env. The form renders only `error`, not
 *     `detail`, so this never reaches an unprivileged screen, but
 *     the `detail` is preserved in the JSON response for tooling
 *     and CloudWatch access logs.
 */

// Listener-rule priority bounds. AWS requires unique priorities per
// listener; agent names are hashed to a stable priority to avoid
// runtime collisions. Range avoids the default action's implicit 0 and
// AWS's reserved tail (50000+).
const PRIORITY_RANGE_MIN = 100
const PRIORITY_RANGE_MAX = 49999

// AWS clients are eagerly initialized at module load (same pattern as
// services.ts / redeploy.ts — reuses the SDK's connection pool +
// credential cache across requests). Tests work because Vitest mocks
// the entire AWS SDK module, not because of any lazy-init magic in
// this file. The region captured here is what the clients actually
// use; resolveEnv()'s `region` field re-reads process.env per-request
// only for response-shape consistency — the AWS calls themselves
// always use AWS_REGION_AT_LOAD.
const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })
const elbv2Client = new ElasticLoadBalancingV2Client({ region: AWS_REGION_AT_LOAD })
const logsClient = new CloudWatchLogsClient({ region: AWS_REGION_AT_LOAD })

interface ResolvedEnv {
  region: string
  clusterName: string
  projectName: string
  environment: string
  prefix: string
  taskRoleArn: string
  executionRoleArn: string
  logGroupPrefix: string
  logRetentionDays: number
  vpcId: string
  subnetIds: string[]
  securityGroupId: string
  litellmAlbDnsName: string
  /**
   * ARN of the LiteLLM master-key secret. #354: required at runtime
   * — MC reads this to authenticate to LiteLLM /key/generate and
   * /key/delete. Empty string → fail-fast `getMissingEnv()` so a
   * misconfigured deployment surfaces the gap as 500 ConfigurationError
   * instead of 502 deep inside the create flow.
   */
  litellmMasterKeySecretArn: string
  sharedAlbName: string
}

/**
 * Read every required env var fresh per-request. Module-level caching
 * was the original shape but it makes env-validation tests impossible
 * to write — module-load constants don't react to `delete process.env.X`
 * within a test. Re-reading per request is fine for create-agent (low
 * frequency, not a hot path).
 */
function resolveEnv(): ResolvedEnv {
  // Cluster/project/env/prefix derivation lives in `lib/fleet-prefix.ts`
  // — single source of truth shared with `harness-defaults.ts`. Round-7
  // audit on PR #39 caught the prior duplicate logic as a drift risk.
  const fleetPrefix = resolveFleetPrefix()
  return {
    region: process.env.AWS_REGION || 'us-east-1',
    clusterName: fleetPrefix.clusterName,
    projectName: fleetPrefix.projectName,
    environment: fleetPrefix.environment,
    prefix: fleetPrefix.prefix,
    taskRoleArn: process.env.MC_AGENT_TASK_ROLE_ARN || '',
    executionRoleArn: process.env.MC_AGENT_EXECUTION_ROLE_ARN || '',
    logGroupPrefix:
      process.env.MC_AGENT_LOG_GROUP_PREFIX ||
      `/ecs/${fleetPrefix.clusterName}`,
    logRetentionDays: (() => {
      const raw = process.env.MC_AGENT_LOG_RETENTION_DAYS
      if (!raw) return 365
      const parsed = parseInt(raw, 10)
      // Fall back to the documented default rather than letting NaN reach
      // PutRetentionPolicy (which would 502 with a confusing serialization
      // error from the AWS SDK). Out-of-range values flow through and get
      // rejected by AWS with a clear message — that's still better than
      // silently retaining for the wrong duration.
      return Number.isFinite(parsed) ? parsed : 365
    })(),
    vpcId: process.env.MC_AGENT_VPC_ID || '',
    subnetIds: (process.env.MC_AGENT_SUBNET_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    securityGroupId: process.env.MC_AGENT_SECURITY_GROUP_ID || '',
    litellmAlbDnsName: process.env.MC_LITELLM_ALB_DNS_NAME || '',
    // #354: required at runtime — MC reads the master key value
    // here to call LiteLLM /key/generate at agent-spawn time. The
    // master key NEVER reaches the agent task-def; agents get a
    // per-agent virtual key minted from this master key.
    litellmMasterKeySecretArn:
      process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN || '',
    sharedAlbName: `${fleetPrefix.prefix}-agents-shared`,
  }
}

export interface CreateAgentRequest {
  harnessType: HarnessType
  agentName: string
  roleDescription: string
  image: string
  /**
   * #357 Phase-2: optional persona fields surfaced by the create-agent
   * form. Init-config (ender-stack#361) hard-templates IDENTITY.md +
   * SOUL.md from these values. All optional; legacy clients that omit
   * them get the same Phase-1 behavior (canonical placeholders +
   * BOOTSTRAP.md first-run conversation fills in identity).
   */
  displayName?: string
  emoji?: string
  persona?: string
}

export interface CreateAgentResponse {
  ok: true
  agentName: string
  resources: {
    serviceArn: string
    taskDefinitionArn: string
    targetGroupArn: string
    listenerRuleArn: string
    logGroup: string
    listenerPath: string
  }
  /**
   * Operational warnings about the created resources. Each entry is a
   * stable code (machine-parseable) + a human-readable message. The
   * 201 response means AWS resources were created successfully — but
   * they may not yet result in a healthy serving agent. Operators (and
   * the Beat 3b UI form) should surface this list rather than silently
   * trust 201 = ready-to-serve. Empty array when there are no known
   * runtime gaps.
   */
  warnings: Array<{ code: string; message: string }>
}

// Stable warning codes. Keep the list small and code-named so the UI
// can render specific guidance per code without parsing message text.
//
// The `warnings` array shape is preserved on the response so future
// warnings can land without a contract change — clients render the
// array generically. The array is currently empty for every
// successful create (no live warnings).

export interface CreateAgentErrorResponse {
  error: string
  detail?: string
  /**
   * Resources successfully created before the failure. Operators can use
   * this to clean up orphans (delete listener rule → delete TG → drop
   * task-def revision) before retrying. Empty when the failure happened
   * before the first successful create. Tracked for partial-failure
   * compensating-transaction support deferred to Beat 3c (the reconciler).
   */
  partialResources?: {
    taskDefinitionArn?: string
    targetGroupArn?: string
    listenerRuleArn?: string
    logGroup?: string
    /**
     * #354: Per-agent LiteLLM virtual key minted via /key/generate
     * before any AWS resource was created. If a downstream AWS call
     * (CreateLogGroup, CreateService, etc.) fails, the key still
     * exists on the LiteLLM proxy and the secret still exists in
     * Secrets Manager. Operators can re-trigger create-agent (the
     * key alias + secret name are deterministic — both will be
     * reused) OR clean up manually by:
     *   - `POST /key/delete key_aliases=[{prefix}-{agent}]` on the
     *     LiteLLM proxy
     *   - `aws secretsmanager delete-secret --secret-id
     *     {prefix}-{agent}-litellm-key`
     */
    litellmKeyAlias?: string
    litellmSecretArn?: string
    /**
     * Defensive: present only when CreateService completed without
     * the serviceArn field (an SDK contract violation — extremely
     * unlikely, but the cost of getting it wrong is an orphaned ECS
     * service the operator can't locate from this response).
     *
     * - `string` value: rare scenario where the SDK returned a
     *   service object with serviceArn populated but a later
     *   verification step (none today) would still throw.
     * - `null` value: we got a response but the serviceArn field was
     *   missing or empty. Operator should `aws ecs describe-services`
     *   on the templated name (`{prefix}-companion-{harness}-{name}`)
     *   to check for an orphan.
     *
     * Round-4 audit on PR #37 (Beat 3b).
     */
    serviceArn?: string | null
  }
}

/** Hash agent name to a deterministic priority within the allowed range. */
function priorityFor(agentName: string): number {
  let h = 5381
  for (let i = 0; i < agentName.length; i++) {
    h = ((h << 5) + h + agentName.charCodeAt(i)) | 0
  }
  const range = PRIORITY_RANGE_MAX - PRIORITY_RANGE_MIN + 1
  return PRIORITY_RANGE_MIN + (Math.abs(h) % range)
}

/**
 * Find a free listener-rule priority via DescribeRules + linear scan
 * from the agent-name hash. Avoids the UX-hostile "rename and retry"
 * workflow that the bare hash imposes on prefix-collision agents
 * (~9.5% probability at 100 agents — birthday-paradox over 49,900
 * slots; see ender-stack#214).
 *
 * Strategy: hash gives a stable starting point, scan forward (with
 * wraparound) until an unoccupied priority is found. When the listener
 * is sparse (the common case), the hashed slot is free on the first
 * check and there's no behavioral difference. Under collision, the
 * scan picks the next free slot deterministically.
 *
 * Race window: a concurrent CreateRule could reserve the picked
 * priority between this call and our own CreateRule, in which case
 * AWS returns PriorityInUseException → the outer 409 path. Phase 2.2
 * is single-MC so the race is theoretical; the reconciler in Beat 3c
 * is the proper home for transactional allocation.
 */
async function allocatePriority(
  client: ElasticLoadBalancingV2Client,
  listenerArn: string,
  agentName: string,
): Promise<number> {
  const start = priorityFor(agentName)
  // Paginate through all rules — DescribeRules caps at 100/page. A
  // listener with >100 rules would otherwise leave occupied slots
  // beyond page 1 invisible, leading to a falsely-free pick that
  // 409s at CreateRule time.
  const occupied = new Set<number>()
  let marker: string | undefined
  do {
    const page = await client.send(
      new DescribeRulesCommand({ ListenerArn: listenerArn, Marker: marker }),
    )
    for (const rule of page.Rules ?? []) {
      // Default rule has Priority='default' (string). Only count the
      // numeric priorities that fall in our 100-49999 allocation range.
      const p = rule.Priority
      if (typeof p === 'string' && /^\d+$/.test(p)) {
        occupied.add(Number(p))
      }
    }
    marker = page.NextMarker
  } while (marker)

  const range = PRIORITY_RANGE_MAX - PRIORITY_RANGE_MIN + 1
  for (let i = 0; i < range; i++) {
    const candidate = PRIORITY_RANGE_MIN + ((start - PRIORITY_RANGE_MIN + i) % range)
    if (!occupied.has(candidate)) return candidate
  }
  // 49,900 occupied slots. Unreachable in practice — the AWS
  // account-level rule limit is far below 49,900 — but defensive.
  throw new Error(
    `No free listener-rule priority available on ${listenerArn} (${occupied.size} occupied)`,
  )
}

function buildTags(env: ResolvedEnv): Record<string, string> {
  return {
    Project: env.projectName,
    Environment: env.environment,
    Owner: 'mission-control',
    ManagedBy: 'mission-control',
  }
}

/** Returns the names of any required env vars that are unset. Empty list = all set. */
function getMissingEnv(env: ResolvedEnv): string[] {
  const missing: string[] = []
  if (!env.taskRoleArn) missing.push('MC_AGENT_TASK_ROLE_ARN')
  if (!env.executionRoleArn) missing.push('MC_AGENT_EXECUTION_ROLE_ARN')
  if (!env.vpcId) missing.push('MC_AGENT_VPC_ID')
  if (env.subnetIds.length === 0) missing.push('MC_AGENT_SUBNET_IDS')
  if (!env.securityGroupId) missing.push('MC_AGENT_SECURITY_GROUP_ID')
  if (!env.litellmAlbDnsName) missing.push('MC_LITELLM_ALB_DNS_NAME')
  // #354: MC reads the master key to mint per-agent virtual keys.
  if (!env.litellmMasterKeySecretArn)
    missing.push('MC_LITELLM_MASTER_KEY_SECRET_ARN')
  // #354: per-agent virtual-key secret is written under this prefix.
  // requireSecretsPrefix() throws ConfigurationError if unset; surface
  // as a missing env entry rather than a 500 later. Catch is narrowed
  // to ConfigurationError (round-5 audit) so a future error path from
  // requireSecretsPrefix doesn't silently misdiagnose as a missing
  // env var.
  try {
    requireSecretsPrefix()
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConfigurationError') {
      missing.push('MC_AGENT_SECRETS_NAME_PREFIX')
    } else {
      throw err
    }
  }
  return missing
}

// agentName regex applied at the harness-agnostic type-guard layer.
// The template-level validateInput re-applies the same regex per-harness
// (defense-in-depth), but the type guard is the load-bearing layer
// because it runs for every harness type and gates ALL access to the
// `ecs:RegisterTaskDefinition Resource:*` grant. If a future harness
// ever omits the regex from its validateInput, this layer keeps the
// security boundary intact.
//
// Anchoring rules: must start AND end with alphanumeric (no
// leading/trailing hyphens, no double-hyphens at the ends).
// Digit-start is permitted (relaxed in Beat 3b.1) — AWS doesn't
// require letter-start for any of the resources MC creates.
// ELBv2 target-group names and ECS service names DO enforce
// no-leading/trailing-hyphen at the AWS layer, so a name like `-foo`
// or `foo-` would 409 at CreateTargetGroup with a confusing
// InvalidParameterException; the regex catches it at the validation
// step instead.
//
// AGENT_NAME_RE imported from `@/extensions/fleet/templates/constraints`
// so the type guard, per-harness validateInput, AND the client-side
// form share the same definition. constraints.ts is the single
// source of truth.

function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  // #357 Phase-2 persona fields are optional — when present they must
  // be strings; otherwise must be absent / undefined. Length + content
  // validation lands in validateOpenClawInput (templates/index.ts) so
  // the operator-facing error messages live with the other field
  // checks.
  const isOptString = (v: unknown) => v === undefined || typeof v === 'string'
  return (
    typeof b.harnessType === 'string' &&
    HARNESS_TYPES.includes(b.harnessType as HarnessType) &&
    typeof b.agentName === 'string' &&
    AGENT_NAME_RE.test(b.agentName as string) &&
    typeof b.roleDescription === 'string' &&
    typeof b.image === 'string' &&
    isOptString(b.displayName) &&
    isOptString(b.emoji) &&
    isOptString(b.persona)
  )
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const resolved = resolveEnv()
  const missing = getMissingEnv(resolved)
  if (missing.length > 0) {
    logger.error(
      { missing },
      '[fleet] create-agent unavailable: required env vars unset',
    )
    return NextResponse.json(
      {
        error: 'ConfigurationError',
        detail: `Missing required env: ${missing.join(', ')}`,
      } satisfies CreateAgentErrorResponse,
      { status: 500 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'InvalidRequestBody' } satisfies CreateAgentErrorResponse,
      { status: 400 },
    )
  }

  if (!isCreateAgentRequest(body)) {
    return NextResponse.json(
      { error: 'InvalidRequestShape' } satisfies CreateAgentErrorResponse,
      { status: 400 },
    )
  }

  const harnessType = body.harnessType
  const template = HARNESS_TEMPLATES[harnessType]
  const input: OpenClawAgentInput = {
    agentName: body.agentName,
    roleDescription: body.roleDescription,
    image: body.image,
    // #357 Phase-2: forward optional persona fields. Undefined when
    // omitted by the client; the template's conditional emission means
    // omitted fields produce no env-var entry on the task-def.
    displayName: body.displayName,
    emoji: body.emoji,
    persona: body.persona,
  }

  // Per-harness validation. Throws on bad input — caught below as 400.
  // Pass `resolved.prefix` so the validator can also enforce
  // deployment-aware constraints (target-group-name combined-length
  // cap for OpenClaw — AWS rejects > 32 chars AFTER task-def +
  // log-group are created, orphaning real billed resources).
  // ImageAllowlistConfigError is a special case: thrown when the env
  // var MC_FLEET_IMAGE_REGISTRY_ALLOWLIST contains a malformed regex
  // pattern. That's an operator misconfiguration, not a request
  // problem; mapping it to 400 ValidationError would mislead the
  // submitter ("my image is fine, why am I getting a 400?"). Surface
  // it as a 500 ConfigurationError that names the bad pattern so the
  // operator can fix the env var rather than the request body.
  try {
    template.validateInput(input, resolved.prefix)
  } catch (err) {
    if (err instanceof ImageAllowlistConfigError) {
      logger.error(
        { badPattern: err.badPattern, message: err.message },
        '[fleet] create-agent unavailable: image allowlist regex misconfigured',
      )
      return NextResponse.json(
        {
          error: 'ConfigurationError',
          detail: err.message,
        } satisfies CreateAgentErrorResponse,
        { status: 500 },
      )
    }
    const message = (err as Error).message
    return NextResponse.json(
      {
        error: 'ValidationError',
        detail: message,
      } satisfies CreateAgentErrorResponse,
      { status: 400 },
    )
  }

  // litellmAgentKeySecretArn is filled in by step 0.5 below — the
  // per-agent virtual-key secret only exists AFTER /key/generate +
  // SecretsManager write succeed. Until then it's undefined and
  // the template would emit an empty `secrets[]` array; the create
  // flow never reaches the template in that state (step 0.5
  // throws and we return 502).
  const env: OpenClawAgentEnv = {
    region: resolved.region,
    prefix: resolved.prefix,
    clusterName: resolved.clusterName,
    taskRoleArn: resolved.taskRoleArn,
    executionRoleArn: resolved.executionRoleArn,
    logGroupPrefix: resolved.logGroupPrefix,
    vpcId: resolved.vpcId,
    subnetIds: resolved.subnetIds,
    securityGroupId: resolved.securityGroupId,
    litellmAlbDnsName: resolved.litellmAlbDnsName,
    tags: buildTags(resolved),
  }

  const logGroupName = `${resolved.logGroupPrefix}/companion-openclaw-${input.agentName}`
  // Surface in the response so operators / clients know what URL paths
  // the agent now answers on. Mirrors the patterns in renderListenerRule
  // — two explicit anchors instead of a wildcard glob.
  const listenerPath = `/agent/${input.agentName} (+ /agent/${input.agentName}/*)`

  // Track resources successfully created so partial-failure 5xx
  // responses can surface them for operator-driven cleanup. Beat 3c
  // (reconciler) will land compensating transactions; until then,
  // operators delete orphans manually using these ARNs.
  const partial: NonNullable<CreateAgentErrorResponse['partialResources']> = {}

  // #354: deterministic alias so the delete path can revoke the
  // key without a secondary lookup. Combining the fleet prefix
  // with the agent name keeps the alias unique across environments
  // sharing one LiteLLM proxy.
  const litellmKeyAlias = `${resolved.prefix}-${input.agentName}`

  try {
    // ================================================================
    // Step 0.4: Pre-flight DescribeServices conflict check (#354 round-12)
    // ================================================================
    // Without this guard, a duplicate create-agent call with the
    // same agentName would fall into step 0.5's
    // `generateKeyWithRotation` path: it would detect the existing
    // alias on the LiteLLM proxy, call /key/delete on the LIVE key
    // the running agent is using, then mint a new one. The
    // downstream CreateTargetGroup would 409 — operator gets a 409
    // response, but the running agent's task (which resolved the
    // key value at task-launch time and is still using it for
    // outbound LiteLLM calls) loses access immediately. Every
    // model call from the running agent starts failing 401/403.
    //
    // Read-only DescribeServices on the templated service name
    // catches the case BEFORE touching LiteLLM. Only ACTIVE
    // services trigger the 409 — INACTIVE (prior failed delete
    // left a tombstone) and DRAINING (mid-teardown) should fall
    // through and let the create attempt fill in any gaps.
    //
    // TOCTOU window: two concurrent creates for the same name can
    // both pass this check, both mint keys, and race at
    // CreateService. The window is the same one allocatePriority
    // already accepts; Phase 2.2 is single-MC so it's theoretical.
    const serviceName = `${resolved.prefix}-companion-openclaw-${input.agentName}`
    const existsCheck = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: resolved.clusterName,
        services: [serviceName],
      }),
    )
    if (existsCheck.services?.[0]?.status === 'ACTIVE') {
      logger.warn(
        {
          cluster: resolved.clusterName,
          serviceName,
          actor: 'user' in auth ? auth.user.id : undefined,
        },
        '[fleet] create-agent rejected — ACTIVE service exists with this name (would revoke live key)',
      )
      return NextResponse.json(
        {
          error: 'ServiceAlreadyExists',
          detail:
            `An ACTIVE agent named "${input.agentName}" already exists. ` +
            'Delete it first via DELETE /api/fleet/agents/{name}, or choose a different name.',
        } satisfies CreateAgentErrorResponse,
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // ================================================================
    // Step 0.5: Mint per-agent LiteLLM virtual key (#354)
    // ================================================================
    // Runs BEFORE any AWS resource is provisioned so a /key/generate
    // failure leaves zero orphans. Sequence:
    //   a. Resolve master key from Secrets Manager (MC's task role
    //      has `SecretsManagerReadLiteLLMMasterKey`).
    //   b. POST /key/generate to the LiteLLM proxy at
    //      http://{albDns}/key/generate with a model allowlist +
    //      monthly budget cap. LiteLLM returns the virtual key.
    //   c. Write the key to Secrets Manager at
    //      `{prefix}-{agent}-litellm-key`. The agent execution
    //      role's wildcard `companion-openclaw-*` GetSecretValue
    //      grant covers it at task launch.
    //   d. Stash the resulting ARN on the template env so the
    //      task-def's `secrets[]` entry points at the per-agent
    //      secret instead of the master key.
    //
    // The master key never reaches the agent task-def in this
    // post-#354 world — it's MC-internal auth for the LiteLLM
    // management API only.
    const masterKey = await getLiteLLMMasterKey(
      resolved.litellmMasterKeySecretArn,
    )
    // http:// is intentional — internal-only ALB (private subnets,
    // internal=true, no ACM cert). The master key rides this as a
    // Bearer token. Threat model:
    //   - Primary mitigation (IAM): only the MC task role has
    //     `SecretsManagerReadLiteLLMMasterKey` (ender-stack PR
    //     #355). A compromised companion-agent task cannot read
    //     the master key — even if it could observe raw subnet
    //     traffic, it has no way to obtain the credential from
    //     SM to use it.
    //   - Secondary mitigation (network reach): the internal ALB
    //     is not reachable from outside the VPC, so any attacker
    //     would already need a same-VPC foothold.
    //   - Round-7 audit correction: an earlier revision of this
    //     comment claimed "AWS encrypts inter-AZ VPC traffic" as a
    //     blanket mitigation; that's only true for specific
    //     Nitro-instance pairs and is not guaranteed for ECS/
    //     Fargate→ALB paths. The IAM + network-reach pair is the
    //     load-bearing protection, NOT VPC-layer encryption.
    // Future ACM Private CA work flips this to https://; coordinate
    // with the matching change in agents-delete.ts step 10 and the
    // `LITELLM_BASE_URL` comment in templates/openclaw.ts so all
    // three flip together.
    const litellmClient = new LiteLLMManagementClient(
      `http://${resolved.litellmAlbDnsName}`,
      masterKey,
    )
    // generateKeyWithRotation handles the operator-retry-after-
    // partial-failure case (round-2 audit, Greptile P1 #1 +
    // Claude "undefined behavior"): if the deterministic alias
    // is already minted on the proxy (left over from a prior
    // failed create), revoke the old key and re-mint. One
    // rotation attempt is sufficient — the surrounding partial-
    // failure state had already orphaned the old key from any
    // agent lifecycle.
    const { key: virtualKey } = await litellmClient.generateKeyWithRotation({
      alias: litellmKeyAlias,
      models: DEFAULT_LITELLM_MODEL_ALLOWLIST,
      maxBudget: DEFAULT_LITELLM_MAX_BUDGET_USD,
    })
    partial.litellmKeyAlias = litellmKeyAlias
    const litellmSecretArn = await writeAgentLiteLLMKey({
      agentName: input.agentName,
      projectName: resolved.projectName,
      environment: resolved.environment,
      virtualKey,
    })
    partial.litellmSecretArn = litellmSecretArn
    env.litellmAgentKeySecretArn = litellmSecretArn

    // 1. Resolve the shared listener ARN. DescribeLoadBalancers (by
    // name) → DescribeListeners (by LB ARN) → filter to the HTTP:80
    // listener. Both calls are read-only and covered by the
    // ELBv2DescribeReadOnly IAM grant.
    //
    // The `Protocol === 'HTTP'` filter is load-bearing for the
    // post-ACM-Private-CA future: when an HTTPS:443 listener is added
    // alongside (or in place of) HTTP:80, picking Listeners[0] would
    // route per-agent rules to whichever listener AWS returned first
    // (typically by creation time, not port — silent misrouting).
    // The filter forces a deliberate choice: per-agent rules attach
    // to the HTTP listener until we explicitly migrate to HTTPS, at
    // which point this filter is the one place to flip.
    const lbResp = await elbv2Client.send(
      new DescribeLoadBalancersCommand({ Names: [resolved.sharedAlbName] }),
    )
    const lbArn = lbResp.LoadBalancers?.[0]?.LoadBalancerArn
    if (!lbArn) {
      throw new Error(
        `Shared agents ALB not found: ${resolved.sharedAlbName}. Has ender-stack/agents-shared-alb been applied?`,
      )
    }
    const listenersResp = await elbv2Client.send(
      new DescribeListenersCommand({ LoadBalancerArn: lbArn }),
    )
    const httpListener = listenersResp.Listeners?.find(
      (l) => l.Protocol === 'HTTP',
    )
    const listenerArn = httpListener?.ListenerArn
    if (!listenerArn) {
      throw new Error(
        `Shared agents ALB has no HTTP listener: ${resolved.sharedAlbName}`,
      )
    }

    // 2. Pre-create the per-agent CloudWatch log group. Without this,
    // the awslogs driver's first write will fail and the task will
    // bootstrap into a stop loop. The alternative (`awslogs-create-group=true`
    // in the log driver options) requires `logs:CreateLogGroup` on the
    // exec role, which is broader than the explicit pre-create here.
    try {
      await logsClient.send(new CreateLogGroupCommand({ logGroupName }))
      partial.logGroup = logGroupName
    } catch (err) {
      const error = err as { name?: string }
      if (error.name !== 'ResourceAlreadyExistsException') throw err
      // Idempotent on retry: log group already exists from a prior partial create.
      // Track it as partial anyway — operator may want to clean up.
      partial.logGroup = logGroupName
    }
    await logsClient.send(
      new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays: resolved.logRetentionDays,
      }),
    )

    // 3. Register the task definition.
    const taskDefInput = template.renderTaskDefinition(input, env)
    const taskDefResp = await ecsClient.send(
      new RegisterTaskDefinitionCommand(taskDefInput),
    )
    const taskDefinitionArn = taskDefResp.taskDefinition?.taskDefinitionArn
    if (!taskDefinitionArn) {
      throw new Error('RegisterTaskDefinition returned no ARN')
    }
    partial.taskDefinitionArn = taskDefinitionArn

    // 4. Create the per-agent target group.
    const tgInput = template.renderTargetGroup(input, env)
    const tgResp = await elbv2Client.send(new CreateTargetGroupCommand(tgInput))
    const targetGroupArn = tgResp.TargetGroups?.[0]?.TargetGroupArn
    if (!targetGroupArn) {
      throw new Error('CreateTargetGroup returned no ARN')
    }
    partial.targetGroupArn = targetGroupArn

    // 5. Attach a listener rule routing `/agent/{name}` and
    // `/agent/{name}/*` → this TG. Two explicit path patterns rather
    // than the simpler `/agent/{name}*` glob — see the renderListenerRule
    // docstring for why prefix-pair agent names (e.g. `bot` + `bot-test`)
    // require the anchoring.
    //
    // Priority allocated via DescribeRules preflight + linear scan from
    // the agent-name hash (see allocatePriority). The hash provides a
    // stable starting point; the scan picks the next free slot under
    // collision. Beat 3c's reconciler will replace this with a
    // transactional allocator backed by SQLite (ender-stack#214) — the
    // preflight pattern races with concurrent CreateRule calls in a
    // multi-MC future, which Phase 2.2 doesn't have.
    const allocatedPriority = await allocatePriority(
      elbv2Client,
      listenerArn,
      input.agentName,
    )
    const ruleSpec = template.renderListenerRule(input, env, {
      targetGroupArn,
      priority: allocatedPriority,
    })
    const ruleResp = await elbv2Client.send(
      new CreateRuleCommand({
        ListenerArn: listenerArn,
        Priority: ruleSpec.priority,
        Conditions: [
          {
            Field: 'path-pattern',
            Values: ruleSpec.pathPatterns,
          },
        ],
        Actions: [
          {
            Type: 'forward',
            TargetGroupArn: targetGroupArn,
          },
        ],
        Tags: ruleSpec.tags,
      }),
    )
    const listenerRuleArn = ruleResp.Rules?.[0]?.RuleArn
    if (!listenerRuleArn) {
      throw new Error('CreateRule returned no ARN')
    }
    partial.listenerRuleArn = listenerRuleArn

    // 6. Create the ECS service. Once this returns, ECS starts
    // pulling the image and provisioning the task; the Fleet panel
    // reflects deployment progress via DescribeServices polling.
    const serviceInput = template.renderService(input, env, {
      taskDefinitionArn,
      targetGroupArn,
    })
    const serviceResp = await ecsClient.send(
      new CreateServiceCommand(serviceInput),
    )
    const serviceArn = serviceResp.service?.serviceArn
    if (!serviceArn) {
      // SDK contract violation: CreateService returned without the
      // serviceArn field. The service WAS likely created on AWS —
      // set partial.serviceArn to `null` (not undefined) so it
      // survives JSON serialization in the response body and
      // signals "we got a CreateService response but no ARN; check
      // ECS console for an orphan." Operator locates via
      // `aws ecs describe-services` on the templated service name.
      partial.serviceArn = null
      throw new Error('CreateService returned no ARN')
    }

    const actor = 'user' in auth ? auth.user.id : undefined

    logger.info(
      {
        agentName: input.agentName,
        harnessType,
        serviceArn,
        taskDefinitionArn,
        targetGroupArn,
        listenerRuleArn,
        actor,
      },
      '[fleet] created agent',
    )

    // Audit-trail entry — surfaces the irreversible admin action in
    // MC's security_events table so an operator reviewing the audit
    // dashboard sees who created which agents and when. The
    // CloudWatch logger.info above captures the full mutation set;
    // this row is the index that points back to it.
    try {
      logSecurityEvent({
        event_type: 'fleet.agent_created',
        severity: 'info',
        source: 'fleet',
        agent_name: input.agentName,
        detail: JSON.stringify({
          harnessType,
          serviceArn,
          taskDefinitionArn,
          targetGroupArn,
          listenerRuleArn,
          actor,
          // #354 round-11 audit: include the per-agent LiteLLM
          // resources for audit symmetry with the delete event
          // (which carries `litellmKeyAlias` + `litellmSecretName`
          // in its `deletedResources` detail). The key alias is
          // deterministic so a reviewer correlating create + delete
          // events for the same agent can match them up.
          litellmKeyAlias,
          litellmSecretArn: partial.litellmSecretArn,
        }),
      })
    } catch (auditErr) {
      // Audit logging is best-effort — don't fail the create over a
      // SQLite hiccup. The CloudWatch entry from logger.info above
      // remains the durable record. Surface the failure as a warn-
      // level log so persistent audit-DB breakage is visible (without
      // it, the security_events dashboard would silently lose every
      // fleet.agent_created row for days before someone noticed). Same
      // pattern auth.ts uses for its own best-effort audit writes.
      logger.warn(
        { err: auditErr, agentName: input.agentName },
        '[fleet] audit log write failed (best-effort; CloudWatch entry above is the authoritative record)',
      )
    }

    return NextResponse.json(
      {
        ok: true,
        agentName: input.agentName,
        resources: {
          serviceArn,
          taskDefinitionArn,
          targetGroupArn,
          listenerRuleArn,
          logGroup: logGroupName,
          listenerPath,
        },
        warnings: [],
      } satisfies CreateAgentResponse,
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string }
    logger.error(
      {
        err,
        agentName: input.agentName,
        harnessType,
        cluster: resolved.clusterName,
        region: resolved.region,
        partialResources: partial,
      },
      '[fleet] create-agent failed',
    )
    // Conflict statuses (service already exists, target group name
    // taken, etc.) → 409. Validation / IAM / account quota → 502.
    //
    // ECS uses InvalidParameterException for BOTH "service already
    // exists" (a real conflict → 409) AND parameter validation
    // failures (bad CPU/memory for Fargate, malformed subnet, etc.
    // → 502). Map by name+message together: only when the message
    // hints at a conflict do we return 409. Otherwise an upstream
    // misconfig like a bad MC_AGENT_SUBNET_IDS would surface as a
    // confusing 409 Conflict instead of the actionable 502.
    const isAlwaysConflictName =
      error.name === 'ResourceAlreadyExistsException' ||
      error.name === 'DuplicateTargetGroupNameException' ||
      error.name === 'PriorityInUseException'
    const isInvalidParameterConflict =
      error.name === 'InvalidParameterException' &&
      typeof error.message === 'string' &&
      /already exists|in use/i.test(error.message)
    const status =
      isAlwaysConflictName || isInvalidParameterConflict ? 409 : 502
    // Surface partialResources so the operator knows what to clean up
    // before retrying — DuplicateTargetGroupNameException on a retry
    // typically means the prior CreateTargetGroup succeeded but the
    // CreateService that followed it failed.
    const hasPartial = Object.keys(partial).length > 0
    return NextResponse.json(
      {
        error: error.name || 'AWSError',
        ...(hasPartial ? { partialResources: partial } : {}),
      } satisfies CreateAgentErrorResponse,
      { status },
    )
  }
}
