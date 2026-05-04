import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
  type Service,
} from '@aws-sdk/client-ecs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * POST /api/fleet/services/:name/redeploy — force-new-deployment on an
 * existing agent-harness-tagged ECS service.
 *
 * Phase-2.1's "thinnest MC-mutates-ECS loop": rolls the existing service
 * onto a fresh task without changing the task def or the desired count.
 * Validates the IAM grant (ecs:UpdateService, scoped per ender-stack
 * PR #187) + the API surface end-to-end before Phase-2.2's full
 * Create-agent flow.
 *
 * Auth: `operator` role required. Lower than Create/Delete (Phase-2.2+)
 * because Redeploy is reversible — it kicks the existing config back
 * onto a fresh task; nothing is created or destroyed.
 *
 * Service-scope guard (defense-in-depth on top of IAM):
 *   The IAM grant from ender-stack PR #187 is cluster-scoped — it permits
 *   UpdateService on any service in the cluster, including platform
 *   services (mission-control, litellm, etc.). To prevent an authenticated
 *   operator from accidentally (or maliciously) restarting a platform
 *   service via this endpoint, the handler does a pre-flight DescribeServices
 *   call and rejects unless the target carries `Component=agent-harness`.
 *   Same tag boundary the Fleet panel renders.
 *
 *   Auditor (#187) flagged: IAM can't restrict `UpdateService` parameters
 *   (no scale-to-zero, no task-def-swap protection at IAM layer). The
 *   handler is the only place that can constrain the call shape, and
 *   sends ONLY `{ forceNewDeployment: true }` — never any client-supplied
 *   fields. Combined with the harness-only guard, blast radius collapses
 *   to "force-restart agent harnesses" — exactly what Phase 2.1 needs.
 *
 * Response 202 (deployment kicked off, not finished):
 *   { ok: true, deploymentId, taskDefinition }
 *
 * Errors return only the SDK error name, not the message — AWS messages
 * embed caller ARN / account ID. Full error stays in CloudWatch via
 * logger.error.
 */

const CLUSTER_NAME = process.env.MC_FLEET_CLUSTER_NAME || 'ender-stack-dev'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

// Module-level singleton — same pattern as services.ts. Reuses connection
// pool + credential cache.
const ecsClient = new ECSClient({ region: AWS_REGION })

// ender-stack#278 follow-up (PR #53 round-1 audit): same
// Cache-Control: no-store sweep applied here. A reverse proxy
// caching a transient 502 from the redeploy endpoint would be
// just as misleading as the credentials case.
const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Same tag convention the Fleet panel filters by. Keep these constants
// in sync with services.ts — Phase 2.x may dedupe into a shared module
// once a third consumer materializes.
const HARNESS_TAG_KEY = 'Component'
const HARNESS_TAG_VALUE = 'agent-harness'

function isAgentHarness(service: Service): boolean {
  return (
    service.tags?.some(
      (t) => t.key === HARNESS_TAG_KEY && t.value === HARNESS_TAG_VALUE,
    ) ?? false
  )
}

export interface FleetRedeployResponse {
  ok: true
  /** ECS deployment ID — opaque, useful for cross-referencing CloudTrail. */
  deploymentId: string | undefined
  /** family:revision of the task def the new deployment is rolling onto. */
  taskDefinition: string | undefined
}

export interface FleetRedeployErrorResponse {
  error: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    )
  }

  const { name } = await params

  try {
    // Pre-flight: confirm the target is an agent harness, not a platform
    // service. The IAM grant (ender-stack #187) is cluster-scoped, so
    // without this guard an operator could redeploy MC / LiteLLM / etc.
    // by their service names.
    const describe = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: [name],
        include: ['TAGS'],
      }),
    )
    const target = describe.services?.[0]
    if (!target || target.status !== 'ACTIVE') {
      // ServiceNotFound or stale (DRAINING/INACTIVE). Same 404 the
      // UpdateService path would surface for ServiceNotFoundException —
      // collapsing both into a single response shape avoids leaking
      // the existence of a non-harness service via timing/response
      // differences.
      return NextResponse.json(
        { error: 'ServiceNotFoundException' } satisfies FleetRedeployErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }
    if (!isAgentHarness(target)) {
      // 404 (not 403) intentionally — refusing to confirm the existence
      // of a non-harness service to a caller asking about it. Logged
      // server-side so legitimate operator typos vs. deliberate probing
      // are distinguishable in CloudWatch.
      logger.warn(
        {
          cluster: CLUSTER_NAME,
          service: name,
          actor: 'user' in auth ? auth.user.id : undefined,
        },
        '[fleet] redeploy refused: target is not Component=agent-harness',
      )
      return NextResponse.json(
        { error: 'ServiceNotFoundException' } satisfies FleetRedeployErrorResponse,
        { status: 404, headers: NO_STORE },
      )
    }

    // Pass ONLY forceNewDeployment — never forward any client-supplied
    // fields. IAM can't restrict UpdateService params; the handler must.
    const resp = await ecsClient.send(
      new UpdateServiceCommand({
        cluster: CLUSTER_NAME,
        service: name,
        forceNewDeployment: true,
      }),
    )

    // Strip account-id-bearing prefix from the task-def ARN at the response
    // boundary, same as services.ts.
    const taskDef = resp.service?.taskDefinition
    const taskDefShort = taskDef ? taskDef.split('/').pop() : undefined

    // Newest deployment is the one we just kicked off. ECS sorts deployments
    // PRIMARY-first by convention but explicit lookup is more robust.
    const newDeployment = resp.service?.deployments?.find(
      (d) => d.status === 'PRIMARY',
    )

    return NextResponse.json(
      {
        ok: true,
        deploymentId: newDeployment?.id,
        taskDefinition: taskDefShort,
      } satisfies FleetRedeployResponse,
      { status: 202, headers: NO_STORE },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string }
    logger.error(
      {
        err,
        cluster: CLUSTER_NAME,
        region: AWS_REGION,
        service: name,
      },
      '[fleet] failed to UpdateService',
    )
    // ServiceNotFoundException → 404 (operator typo or stale UI); other
    // SDK errors → 502 (likely IAM scope or AWS issue).
    const status = error.name === 'ServiceNotFoundException' ? 404 : 502
    return NextResponse.json(
      { error: error.name || 'AWSError' } satisfies FleetRedeployErrorResponse,
      { status, headers: NO_STORE },
    )
  }
}
