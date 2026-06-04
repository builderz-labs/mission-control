import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  ListServicesCommand,
  DescribeServicesCommand,
  type Service,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  withTimeout,
  upstreamErrorBody,
  classifyEcsFailures,
} from '@/extensions/fleet/lib/aws-hardening'

/**
 * GET /api/fleet/services — list ECS services in the configured cluster.
 *
 * Phase-2.0 read-only foundation for the MC "Fleet" page (production
 * agents deployed to ECS Fargate, distinct from upstream's /agents page
 * which serves the local/docker dev-iteration workflow). Calls
 * `ecs:ListServices` + `ecs:DescribeServices` against a single cluster
 * (per-deployment OSS-fork model — each consuming org's MC sees its own
 * cluster only). The companion task role's IAM grant for these actions
 * is provisioned in the ender-stack repo (PR #150).
 *
 * Cluster name comes from MC_FLEET_CLUSTER_NAME with a sensible default
 * (`ender-stack-dev`). Region from AWS_REGION (set automatically on
 * Fargate task metadata; falls back to us-east-1 for local dev).
 *
 * Auth: gated by `requireRole(request, 'viewer')` — same minimum tier
 * as other read-only extension endpoints (litellm/cache, etc.).
 *
 * Error responses return only the SDK error name (no message detail) to
 * avoid leaking IAM ARNs / account IDs into the browser. Full stack
 * remains in CloudWatch via the logger.error call.
 */

const CLUSTER_NAME = process.env.MC_FLEET_CLUSTER_NAME || 'ender-stack-dev'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

// Service-arn page size cap on DescribeServicesCommand is 10 (AWS-side
// limit). The handler chunks ARNs across multiple parallel Describe calls
// — see the Promise.all block below. The follow-up still pending is
// ListServices nextToken pagination (i.e. clusters with > 100 services),
// not Describe chunking.
const MAX_SERVICES_PER_DESCRIBE = 10

// ListServices first-page cap. Past this size, the response is marked
// truncated and the UI warns; nextToken pagination is a follow-up.
const LIST_SERVICES_MAX_RESULTS = 100

// Module-level singleton — reuses connection pool + credential cache
// across requests. (Per-request `new ECSClient()` triggers fresh IMDS
// resolution on Fargate.)
const ecsClient = new ECSClient({ region: AWS_REGION })

export interface FleetServiceSummary {
  name: string
  status: string | undefined
  desiredCount: number | undefined
  runningCount: number | undefined
  pendingCount: number | undefined
  /**
   * Family + revision only (e.g. `ender-stack-dev-litellm:7`). The full ECS
   * task-definition ARN embeds the AWS account ID, which we strip at the
   * response boundary so it never reaches the browser.
   */
  taskDefinition: string | undefined
  launchType: string | undefined
  /**
   * Number of deployments currently in `IN_PROGRESS` rolloutState — non-zero
   * means an active rollout is mid-flight. (ECS keeps PRIMARY/ACTIVE/INACTIVE
   * deployments in `service.deployments`, so a raw `.length` over-counts.)
   */
  activeDeployments: number
}

export interface FleetServicesResponse {
  cluster: string
  region: string
  services: FleetServiceSummary[]
  /** True when ListServices hit its first-page cap; UI should warn. */
  truncated: boolean
}

export interface FleetServicesErrorResponse {
  error: string
}

function summarizeService(service: Service): FleetServiceSummary {
  // ECS service ARN format (post-2023): arn:aws:ecs:region:account:service/cluster/name
  // Extract the friendly name (the last path segment).
  const arn = service.serviceArn || ''
  const name = arn.split('/').pop() || service.serviceName || '(unknown)'

  // Strip the account-id-bearing prefix from the task-def ARN, returning
  // only `family:revision`. Full ARN is in CloudWatch via DescribeServices.
  // Format: arn:aws:ecs:region:account:task-definition/family:revision
  const taskDef = service.taskDefinition
  const taskDefShort = taskDef ? taskDef.split('/').pop() : undefined

  return {
    name,
    status: service.status,
    desiredCount: service.desiredCount,
    runningCount: service.runningCount,
    pendingCount: service.pendingCount,
    taskDefinition: taskDefShort,
    launchType: service.launchType,
    activeDeployments:
      service.deployments?.filter((d) => d.rolloutState === 'IN_PROGRESS')
        .length ?? 0,
  }
}

// Tag-based filter — services must carry `Component=agent-harness` to be
// included in the response. Always-on, no query param: Fleet is the
// agent-control-plane page, not a cluster-wide service inventory. Platform
// services (mission-control, litellm, langfuse, etc.) carry
// `Component=platform-service` per the ender-stack convention and are
// excluded. Untagged services (no Component tag at all) are also excluded —
// any new ECS service module needs to declare a Component value to render
// in Fleet.
const HARNESS_TAG_KEY = 'Component'
const HARNESS_TAG_VALUE = 'agent-harness'

function isAgentHarness(service: Service): boolean {
  return (
    service.tags?.some(
      (t) => t.key === HARNESS_TAG_KEY && t.value === HARNESS_TAG_VALUE,
    ) ?? false
  )
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    // ender-stack#280: per-call timeout so a stuck ECS call can't hang the request.
    const listResp = await (async () => {
      const t = withTimeout()
      try {
        return await ecsClient.send(
          new ListServicesCommand({
            cluster: CLUSTER_NAME,
            maxResults: LIST_SERVICES_MAX_RESULTS,
          }),
          { abortSignal: t.signal },
        )
      } finally {
        t.clear()
      }
    })()

    const arns = listResp.serviceArns ?? []
    // Use AWS's authoritative pagination signal (nextToken) instead of
    // count comparison — a cluster with exactly LIST_SERVICES_MAX_RESULTS
    // services has no nextToken and is NOT truncated.
    const truncated = !!listResp.nextToken

    if (arns.length === 0) {
      return NextResponse.json(
        {
          cluster: CLUSTER_NAME,
          region: AWS_REGION,
          services: [],
          truncated,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // DescribeServices caps at 10 ARNs per call. Chunk and run in parallel —
    // 10 chunks worst-case (LIST_SERVICES_MAX_RESULTS=100) collapse from
    // 10 serial RTTs to 1. `include: ['TAGS']` is required to receive the
    // tag array — without it the field is absent and the harness filter
    // would always return zero results.
    const chunks: string[][] = []
    for (let i = 0; i < arns.length; i += MAX_SERVICES_PER_DESCRIBE) {
      chunks.push(arns.slice(i, i + MAX_SERVICES_PER_DESCRIBE))
    }

    // ender-stack#280: per-call timeout per chunk (one handle per send).
    const descs = await Promise.all(
      chunks.map(async (chunk) => {
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
      }),
    )

    const all: Service[] = []
    for (const desc of descs) {
      if (desc.services) {
        all.push(...desc.services)
      }
      // ender-stack#281: a MISSING failure (service deleted between
      // ListServices and DescribeServices) is benign — log + continue. A
      // non-MISSING failure (e.g. IAM denial) must 502 instead of
      // silently dropping services from the list.
      const classified = classifyEcsFailures(desc.failures)
      if (classified.missing.length > 0) {
        logger.warn(
          {
            cluster: CLUSTER_NAME,
            failures: classified.missing,
          },
          '[fleet] DescribeServices reported per-ARN failures',
        )
      }
      if (classified.hasNonMissing) {
        logger.error(
          {
            cluster: CLUSTER_NAME,
            denied: classified.denied,
            other: classified.other,
          },
          '[fleet] DescribeServices returned non-MISSING failures (likely IAM denial)',
        )
        return NextResponse.json(upstreamErrorBody(), {
          status: 502,
          headers: { 'Cache-Control': 'no-store' },
        })
      }
    }

    const filtered = all.filter(isAgentHarness)

    return NextResponse.json(
      {
        cluster: CLUSTER_NAME,
        region: AWS_REGION,
        services: filtered.map(summarizeService),
        truncated,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string; stack?: string }
    logger.error(
      {
        err,
        errorName: error.name,
        cluster: CLUSTER_NAME,
        region: AWS_REGION,
      },
      '[fleet] failed to list/describe ECS services',
    )
    // ender-stack#274: redact raw AWS error name from the client-facing
    // body (AWS messages/names embed ARNs + account IDs). Real name is
    // logged via logger.error above. ender-stack#278: add Cache-Control:
    // no-store — this was the lone error path missing it.
    return NextResponse.json(upstreamErrorBody(), {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
