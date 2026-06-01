import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  ListServicesCommand,
  DescribeServicesCommand,
  UpdateServiceCommand,
  type Service,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
import { mutationLimiter } from '@/lib/rate-limit'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import {
  withTimeout,
  upstreamErrorBody,
  classifyEcsFailures,
} from '@/extensions/fleet/lib/aws-hardening'

/**
 * POST /api/fleet/bulk-redeploy — force-new-deployment across many
 * agent-harness ECS services in one call.
 *
 * Motivation (#516): the per-agent `POST /api/fleet/services/:name/redeploy`
 * (redeploy.ts) is a per-agent click/CLI loop. After merging an ender-stack
 * fix + image push, an operator must roll every agent harness one at a time —
 * the agents that get skipped silently run stale code. This endpoint rolls a
 * filtered set in a single operator action, so "merge a fix → roll all agents"
 * is one call. It's a batch WRAPPER over the same primitive redeploy.ts uses
 * (`UpdateService({ forceNewDeployment: true })`), reusing the same guards.
 *
 * Auth: `operator` — same tier as per-agent redeploy. Redeploy is reversible
 * (kicks the existing config onto a fresh task; nothing created/destroyed).
 *
 * Atomic harness guard (defense-in-depth on top of IAM):
 *   The IAM grant (ender-stack PR #187) is cluster-scoped — it permits
 *   UpdateService on any service in the cluster, including platform services
 *   (mission-control, litellm, etc.). EVERY target is pre-flight
 *   DescribeServices-checked (with TAGS) against the two-tag harness boundary
 *   (`Component=agent-harness` AND `ManagedBy=mission-control`, via
 *   ecs-guards.isAgentHarness). For `explicit` mode the WHOLE batch is rejected
 *   if any target fails — atomic, not best-effort: no UpdateService fires until
 *   every target passes. For `all`/`by-tag` modes the guard is what BUILDS the
 *   target set (discovery returns only harnesses), so non-harnesses can never
 *   enter the batch.
 *
 *   As in redeploy.ts, only `{ forceNewDeployment: true }` is ever sent —
 *   never any client-supplied field. IAM can't constrain UpdateService params;
 *   the handler is the only place that can.
 *
 * Confirmation gate:
 *   When the resolved target count is > 5, the caller must echo the exact
 *   `confirm: "REDEPLOY-<N>-AGENTS"` string (N = resolved count). Because
 *   `all`/`by-tag` counts aren't known until discovery, an un-confirmed
 *   over-threshold request returns 400 with the expected token so a CLI/UI
 *   second call can supply it.
 *
 * Response 202 (deployments kicked off, not finished):
 *   { ok: true, mode, count, results: [{ service, deploymentId?, taskDefinition?, ok, error? }] }
 *   Per-service UpdateService failures are best-effort (collected in `results`
 *   with `ok:false`); they do not unwind the batch. The atomic guarantee is
 *   the pre-flight harness guard, not the mutation phase.
 *
 * Errors return only a stable code (no raw AWS error names — those embed
 * caller ARN / account ID). Full error stays in CloudWatch via logger.error.
 */

const CLUSTER_NAME = process.env.MC_FLEET_CLUSTER_NAME || 'ender-stack-dev'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

// Module-level singleton — same pattern as services.ts / redeploy.ts. Reuses
// the connection pool + credential cache across requests.
const ecsClient = new ECSClient({ region: AWS_REGION })

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// DescribeServices caps at 10 service ARNs per call (AWS-side limit).
const MAX_SERVICES_PER_DESCRIBE = 10
// ListServices page size for the `all`/`by-tag` discovery scan. Unlike
// services.ts (first-page-only + `truncated` flag), bulk paginates fully via
// nextToken below — a silent cap would leave some agents un-rolled, which is
// exactly the stale-code failure this endpoint exists to prevent.
const LIST_SERVICES_PAGE_SIZE = 100
// Upper bound on explicit target names — bounds blast radius + the size of a
// single DescribeServices fan-out for a hostile/buggy caller. A fleet with
// more than this many agents to roll at once should use `all` (or `by-tag`)
// mode, which discovers + rolls every harness without enumerating names.
const MAX_EXPLICIT_SERVICES = 200
// Parallel UpdateService cap. ECS throttles aggressive callers; 5 keeps the
// batch moving without tripping rate limits on large fleets.
const UPDATE_CONCURRENCY = 5
// Parallel DescribeServices cap during discovery — same rationale. An
// unbounded fan-out on a large cluster can self-throttle and 502 the whole
// rollout before any UpdateService fires.
const DESCRIBE_CONCURRENCY = 5
// Count above which an explicit confirmation string is required.
const CONFIRM_THRESHOLD = 5

export type BulkRedeployMode = 'all' | 'by-tag' | 'explicit'

export interface BulkRedeployRequest {
  filter: {
    mode: BulkRedeployMode
    /** explicit mode — exact ECS service names to roll. */
    services?: string[]
    /** by-tag mode — additional tag the harness must carry. */
    tagKey?: string
    tagValue?: string
  }
  /** Required when the resolved target count exceeds CONFIRM_THRESHOLD. */
  confirm?: string
}

export interface BulkRedeployResult {
  service: string
  ok: boolean
  /** ECS deployment ID of the kicked-off rollout (present when ok). */
  deploymentId?: string
  /** family:revision the new deployment rolls onto (present when ok). */
  taskDefinition?: string
  /** Stable error code when this single UpdateService failed (ok:false). */
  error?: string
}

export interface BulkRedeployResponse {
  ok: true
  mode: BulkRedeployMode
  /** Number of services a redeploy was attempted on. */
  count: number
  results: BulkRedeployResult[]
}

export interface BulkRedeployErrorResponse {
  error: string
  /** Offending service names for ServiceNotFoundException / NotAgentHarness. */
  services?: string[]
  /** Resolved target count + expected token for ConfirmationRequired. */
  count?: number
  expected?: string
}

function err(
  body: BulkRedeployErrorResponse,
  status: number,
): NextResponse<BulkRedeployErrorResponse> {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** Service name from an ECS service ARN (or the serviceName fallback). */
function serviceNameOf(service: Service): string {
  const arn = service.serviceArn || ''
  return arn.split('/').pop() || service.serviceName || '(unknown)'
}

/**
 * DescribeServices over an arbitrary number of names, chunked at the AWS
 * 10-per-call cap and run in parallel. Returns the merged services plus a
 * `hasNonMissing` flag (any per-ARN failure that ISN'T a benign MISSING —
 * e.g. an IAM denial — which the caller must surface as a 502, never as
 * "not found"). Each call carries a per-call timeout (#280).
 */
async function describeInChunks(
  names: string[],
): Promise<{ services: Service[]; hasNonMissing: boolean }> {
  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += MAX_SERVICES_PER_DESCRIBE) {
    chunks.push(names.slice(i, i + MAX_SERVICES_PER_DESCRIBE))
  }
  // Bound the describe fan-out the same way the update phase is bounded —
  // an unbounded Promise.all over every chunk can self-throttle on a large
  // cluster and reject the whole discovery before any rollout starts.
  const descs = await mapWithConcurrency(
    chunks,
    DESCRIBE_CONCURRENCY,
    async (chunk) => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new DescribeServicesCommand({
            cluster: CLUSTER_NAME,
            services: chunk,
            include: ['TAGS'],
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    },
  )
  const services: Service[] = []
  let hasNonMissing = false
  for (const desc of descs) {
    if (desc.services) services.push(...desc.services)
    if (classifyEcsFailures(desc.failures).hasNonMissing) hasNonMissing = true
  }
  return { services, hasNonMissing }
}

/** Sentinel thrown when discovery hits a non-MISSING Describe failure. */
class BulkUpstreamError extends Error {
  constructor() {
    super('upstream ECS describe failure during discovery')
    this.name = 'BulkUpstreamError'
  }
}

/**
 * Paginate ListServices fully (nextToken loop) and Describe each page's ARNs
 * for tags. Returns every ACTIVE agent-harness service in the cluster.
 * Throws a sentinel Error on a non-MISSING Describe failure so the caller's
 * catch maps it to a 502.
 */
async function discoverHarnessServices(): Promise<Service[]> {
  const arns: string[] = []
  let nextToken: string | undefined
  do {
    const t = withTimeout()
    let page
    try {
      page = await ecsClient.send(
        new ListServicesCommand({
          cluster: CLUSTER_NAME,
          maxResults: LIST_SERVICES_PAGE_SIZE,
          nextToken,
        }),
        { abortSignal: t.signal },
      )
    } finally {
      t.clear()
    }
    arns.push(...(page.serviceArns ?? []))
    nextToken = page.nextToken
  } while (nextToken)

  if (arns.length === 0) return []

  const { services, hasNonMissing } = await describeInChunks(arns)
  if (hasNonMissing) {
    throw new BulkUpstreamError()
  }
  return services.filter((s) => s.status === 'ACTIVE' && isAgentHarness(s))
}

function hasTag(service: Service, key: string, value: string): boolean {
  return service.tags?.some((t) => t.key === key && t.value === value) ?? false
}

/**
 * Run `worker` over `items` with at most `limit` concurrent invocations.
 * Preserves input order in the returned results. No external dep (the repo
 * has no p-limit) — a small fixed-size worker-pool walking a shared cursor.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++
        if (i >= items.length) return
        results[i] = await worker(items[i], i)
      }
    },
  )
  await Promise.all(runners)
  return results
}

function isBulkRedeployRequest(body: unknown): body is BulkRedeployRequest {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (!b.filter || typeof b.filter !== 'object') return false
  const f = b.filter as Record<string, unknown>
  if (f.mode !== 'all' && f.mode !== 'by-tag' && f.mode !== 'explicit') {
    return false
  }
  if (b.confirm !== undefined && typeof b.confirm !== 'string') return false
  if (f.mode === 'explicit') {
    if (!Array.isArray(f.services) || f.services.length === 0) return false
    if (
      !f.services.every((s) => typeof s === 'string' && s.trim().length > 0)
    ) {
      return false
    }
    // Cap on the DEDUPED set, not the raw array, so a client that accidentally
    // repeats a name (e.g. 201 copies of one service) isn't rejected when the
    // real target set is tiny. The handler dedups identically before describe.
    const uniqueServices = new Set((f.services as string[]).map((s) => s.trim()))
    if (uniqueServices.size > MAX_EXPLICIT_SERVICES) return false
  }
  if (f.mode === 'by-tag') {
    if (typeof f.tagKey !== 'string' || f.tagKey.trim().length === 0) {
      return false
    }
    if (typeof f.tagValue !== 'string' || f.tagValue.trim().length === 0) {
      return false
    }
  }
  return true
}

/** UpdateService({ forceNewDeployment }) for a single target — best-effort. */
async function redeployOne(name: string): Promise<BulkRedeployResult> {
  try {
    const t = withTimeout()
    let resp
    try {
      resp = await ecsClient.send(
        new UpdateServiceCommand({
          cluster: CLUSTER_NAME,
          service: name,
          forceNewDeployment: true,
        }),
        { abortSignal: t.signal },
      )
    } finally {
      t.clear()
    }
    const taskDef = resp.service?.taskDefinition
    const taskDefShort = taskDef ? taskDef.split('/').pop() : undefined
    const newDeployment = resp.service?.deployments?.find(
      (d) => d.status === 'PRIMARY',
    )
    return {
      service: name,
      ok: true,
      deploymentId: newDeployment?.id,
      taskDefinition: taskDefShort,
    }
  } catch (e) {
    const error = e as { name?: string }
    logger.error(
      { errorName: error.name, cluster: CLUSTER_NAME, service: name },
      '[fleet] bulk-redeploy: UpdateService failed for one target',
    )
    // Redact the raw AWS error name (leaks IAM/account topology), except the
    // safe operator signal ServiceNotFoundException (raced delete between
    // discovery and update).
    const code =
      error.name === 'ServiceNotFoundException'
        ? 'ServiceNotFoundException'
        : 'UpstreamServiceError'
    return { service: name, ok: false, error: code }
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    // Match redeploy.ts: NextResponse.json (untyped body) rather than the
    // typed err() helper — auth.error narrows to string | undefined here.
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    )
  }

  // ender-stack#272: rate-limit this mutating endpoint before any AWS call.
  const rateCheck = mutationLimiter(request)
  if (rateCheck) {
    // mutationLimiter's 429 doesn't carry no-store; add it so this mutating
    // endpoint never has a cacheable response path (a proxy could otherwise
    // serve a stale 429 past the rate-limit window).
    rateCheck.headers.set('Cache-Control', 'no-store')
    return rateCheck
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err({ error: 'InvalidRequestBody' }, 400)
  }
  if (!isBulkRedeployRequest(body)) {
    return err({ error: 'InvalidRequestShape' }, 400)
  }

  const mode = body.filter.mode
  const actor = 'user' in auth ? auth.user.id : undefined

  try {
    // ----------------------------------------------------------------
    // Resolve the target set — harness guard runs here, before any
    // UpdateService. For `explicit` the whole batch is rejected if any
    // target fails; for `all`/`by-tag` discovery only yields harnesses.
    // ----------------------------------------------------------------
    let targets: string[]

    if (mode === 'explicit') {
      const requested = Array.from(
        new Set((body.filter.services ?? []).map((s) => s.trim())),
      )
      const { services, hasNonMissing } = await describeInChunks(requested)
      if (hasNonMissing) {
        logger.error(
          { cluster: CLUSTER_NAME, actor },
          '[fleet] bulk-redeploy: DescribeServices returned non-MISSING failures (likely IAM denial)',
        )
        return err(upstreamErrorBody(), 502)
      }
      const byName = new Map<string, Service>()
      for (const s of services) byName.set(serviceNameOf(s), s)

      const notFound: string[] = []
      const notHarness: string[] = []
      for (const name of requested) {
        const svc = byName.get(name)
        if (!svc || svc.status !== 'ACTIVE') {
          notFound.push(name)
        } else if (!isAgentHarness(svc)) {
          notHarness.push(name)
        }
      }
      // Atomic: reject the WHOLE batch if any target is unresolvable or not
      // an MC-managed harness. Operator supplied these names, so echoing the
      // offenders is not an existence-leak (unlike redeploy.ts's single-name
      // uniform-404 posture for unauthenticated probing).
      if (notFound.length > 0) {
        logger.warn(
          { cluster: CLUSTER_NAME, notFound, actor },
          '[fleet] bulk-redeploy refused: some explicit targets not found / not ACTIVE',
        )
        return err(
          { error: 'ServiceNotFoundException', services: notFound },
          404,
        )
      }
      if (notHarness.length > 0) {
        logger.warn(
          { cluster: CLUSTER_NAME, notHarness, actor },
          '[fleet] bulk-redeploy refused: some explicit targets are not Component=agent-harness + ManagedBy=mission-control',
        )
        return err({ error: 'NotAgentHarness', services: notHarness }, 400)
      }
      targets = requested
    } else {
      // all / by-tag — discovery returns only ACTIVE harnesses.
      let harnesses = await discoverHarnessServices()
      if (mode === 'by-tag') {
        const tagKey = body.filter.tagKey as string
        const tagValue = body.filter.tagValue as string
        harnesses = harnesses.filter((s) => hasTag(s, tagKey, tagValue))
      }
      targets = harnesses.map(serviceNameOf)
    }

    // Nothing to do — 200 (not an error; an operator rolling an empty filter
    // is a no-op, not a failure).
    if (targets.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          mode,
          count: 0,
          results: [],
        } satisfies BulkRedeployResponse,
        { status: 200, headers: NO_STORE },
      )
    }

    // ----------------------------------------------------------------
    // Confirmation gate for large batches.
    // ----------------------------------------------------------------
    if (targets.length > CONFIRM_THRESHOLD) {
      const expected = `REDEPLOY-${targets.length}-AGENTS`
      if (body.confirm !== expected) {
        // Log the actor here too (audit symmetry with the success path) so a
        // large unconfirmed attempt is traceable, not just confirmed rolls.
        logger.info(
          { mode, count: targets.length, actor, cluster: CLUSTER_NAME },
          '[fleet] bulk-redeploy: confirmation required for large batch',
        )
        return err(
          { error: 'ConfirmationRequired', count: targets.length, expected },
          400,
        )
      }
    }

    // ----------------------------------------------------------------
    // Roll the batch (concurrency-capped). Per-service failures are
    // collected, not thrown — the atomic guarantee was the guard above.
    // ----------------------------------------------------------------
    const results = await mapWithConcurrency(targets, UPDATE_CONCURRENCY, (name) =>
      redeployOne(name),
    )
    const failed = results.filter((r) => !r.ok).length

    logger.info(
      { mode, count: targets.length, failed, actor, cluster: CLUSTER_NAME },
      '[fleet] bulk-redeploy issued',
    )
    try {
      logSecurityEvent({
        event_type: 'fleet.bulk-redeploy',
        severity: 'info',
        source: 'fleet',
        detail: JSON.stringify({
          mode,
          count: targets.length,
          failed,
          // Cap the inline list so a 200-agent `all` rollout doesn't bloat the
          // security_events TEXT column; count + mode carry the audit signal.
          services:
            targets.length <= 20
              ? targets
              : [...targets.slice(0, 20), `…and ${targets.length - 20} more`],
          actor,
        }),
      })
    } catch (auditErr) {
      // Best-effort audit (same posture as agents.ts) — the logger.info above
      // is the durable record.
      logger.warn(
        { err: auditErr },
        '[fleet] bulk-redeploy: audit log write failed (best-effort)',
      )
    }

    return NextResponse.json(
      {
        ok: true,
        mode,
        count: targets.length,
        results,
      } satisfies BulkRedeployResponse,
      { status: 202, headers: NO_STORE },
    )
  } catch (e) {
    const error = e as { name?: string }
    logger.error(
      {
        err: e,
        errorName: error.name,
        cluster: CLUSTER_NAME,
        region: AWS_REGION,
        mode,
      },
      '[fleet] bulk-redeploy failed',
    )
    return err(upstreamErrorBody(), 502)
  }
}
