import { NextRequest, NextResponse } from 'next/server'
import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
  ListTaskDefinitionsCommand,
  DeregisterTaskDefinitionCommand,
} from '@aws-sdk/client-ecs'
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeListenersCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'
import {
  CloudWatchLogsClient,
  DeleteLogGroupCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
import { AGENT_NAME_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'

/**
 * DELETE /api/fleet/agents/:name — tear down an MC-managed agent end-to-end.
 *
 * Phase 2.2 Beat 4c. Companion to POST /api/fleet/agents (Beat 3a).
 * Removes every AWS resource the create handler provisioned for the
 * agent: ECS service, listener rule on the shared ALB, target group,
 * CloudWatch log group, and all task-def revisions.
 *
 * Auth: `admin` role required — same tier as create. Permanent
 * destruction; not reversible at the IAM grant boundary.
 *
 * Service-scope guard (defense-in-depth on top of IAM):
 *   IAM grants are scoped to `companion-openclaw-*` ARN patterns, but
 *   that wildcard would also match the smoke-test (which is owned by
 *   Terraform, not MC). The handler does a pre-flight DescribeServices
 *   and refuses unless the target carries `Component=agent-harness`
 *   AND wasn't created by Terraform (`ManagedBy=mission-control`).
 *   This protects the smoke-test from accidental deletion via this
 *   endpoint and matches the tag boundary the Fleet panel renders.
 *
 * Idempotency:
 *   Each AWS call's "not found" failure mode is caught + logged as a
 *   warning, not raised. An operator re-running DELETE on a
 *   half-deleted agent (e.g., previous attempt 502'd after listener
 *   rule cleanup) finishes the job rather than 502'ing on the
 *   already-cleaned-up resource. The response surfaces a `warnings`
 *   array enumerating which steps were already idempotent.
 *
 * Tear-down order is load-bearing:
 *   1. DescribeServices → 404 if missing, 404 if not an agent-harness
 *   2. UpdateService desiredCount=0 — drain
 *   3. Resolve listener rule ARN via DescribeRules pagination (the
 *      ARN is non-deterministic; AWS assigns at CreateRule time)
 *   4. DeleteRule — must precede DeleteTargetGroup (TG can't be
 *      deleted while attached to a rule)
 *   5. Resolve target group ARN via DescribeTargetGroups by name
 *      (only the trailing hash is non-deterministic)
 *   6. DeleteTargetGroup
 *   7. ListTaskDefinitions family + DeregisterTaskDefinition for each
 *      ACTIVE revision (cosmetic — INACTIVE revisions are still
 *      retained by AWS indefinitely, but matches platform hygiene)
 *   8. DeleteService force=true — force flag is safe here because
 *      step 2 already drained desiredCount to 0; force=true also
 *      stops any still-shutting-down task that would otherwise
 *      hold up the next step
 *   9. DeleteLogGroup — name is fully derived from prefix + agentName.
 *      Deliberately ordered after DeleteService for log-flush
 *      reasons: while ECS is terminating the final container, the
 *      awslogs driver may still be flushing its tail buffer. The
 *      ordering doesn't give a real drain window (force=true makes
 *      the kill immediate), but the latency of the DeleteService API
 *      call ahead of DeleteLogGroup is still strictly better than
 *      the reverse — a few hundred ms is enough to flush a small
 *      tail buffer in practice.
 *
 * Error response shape:
 *   - **AWS-SDK errors (non-idempotent failures)**: only the SDK
 *     `error.name` surfaces — no `detail`. Full stack stays in
 *     CloudWatch. `deletedResources` enumerates what was successfully
 *     cleaned up before the failure; `failedResources` enumerates
 *     what's left for the operator.
 *   - **404**: service not found OR exists but isn't an agent-harness.
 *     Same response shape for both — refusing to confirm the existence
 *     of a non-harness service to a caller asking about it.
 *   - **400**: agentName fails the regex check (security control;
 *     same regex as POST per templates/constraints.ts).
 */

const AWS_REGION_AT_LOAD = process.env.AWS_REGION || 'us-east-1'
const ecsClient = new ECSClient({ region: AWS_REGION_AT_LOAD })
const elbv2Client = new ElasticLoadBalancingV2Client({ region: AWS_REGION_AT_LOAD })
const logsClient = new CloudWatchLogsClient({ region: AWS_REGION_AT_LOAD })

interface DeletedResources {
  serviceArn?: string
  listenerRuleArn?: string
  targetGroupArn?: string
  logGroup?: string
  taskDefinitionRevisions?: string[]
}

export interface DeleteAgentResponse {
  ok: true
  agentName: string
  deletedResources: DeletedResources
  /**
   * Idempotency reports — the array is empty when every resource was
   * present and successfully deleted. Entries surface "already-deleted"
   * cases so an operator running DELETE on a half-cleaned agent sees
   * what was already gone vs. what this call removed.
   */
  warnings: Array<{ code: string; message: string }>
}

export interface DeleteAgentErrorResponse {
  error: string
  detail?: string
  /** Resources successfully deleted before the failure. */
  deletedResources?: DeletedResources
  /** Resources still present that the operator must clean up manually. */
  failedResources?: DeletedResources
}


/**
 * Shared `aws-sdk-error-name === expected` test that handles the
 * region-specific exception name suffixes the SDK sometimes adds.
 */
function isErrorOfType(err: unknown, names: string[]): boolean {
  const name = (err as { name?: string })?.name
  return typeof name === 'string' && names.includes(name)
}

const NOT_FOUND_NAMES = {
  service: ['ServiceNotFoundException', 'ServiceNotActiveException'],
  rule: ['RuleNotFoundException', 'RuleNotFound'],
  targetGroup: ['TargetGroupNotFoundException', 'TargetGroupNotFound'],
  logGroup: ['ResourceNotFoundException'],
  taskDef: ['ClientException', 'InvalidParameterException'],
} as const

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { name: agentName } = await params

  // Same regex as POST (templates/constraints.ts AGENT_NAME_RE) — the
  // load-bearing security control. The IAM grants on ECS/ELBv2/Logs
  // delete verbs are scoped to ARN patterns derived from this regex;
  // a malformed name could either 4xx at AWS or, worse, traverse out
  // of the agent-harness scope (e.g. `..` in path-segment context).
  // Catch it here.
  if (!agentName || !AGENT_NAME_RE.test(agentName)) {
    return NextResponse.json(
      {
        error: 'InvalidAgentName',
        detail: `agentName must match ${AGENT_NAME_RE.source}`,
      } satisfies DeleteAgentErrorResponse,
      { status: 400 },
    )
  }

  const fleetPrefix = resolveFleetPrefix()
  const prefix = fleetPrefix.prefix
  const clusterName = fleetPrefix.clusterName
  const sharedAlbName = `${prefix}-agents-shared`
  const serviceName = `${prefix}-companion-openclaw-${agentName}`
  const tgName = `${prefix}-agent-${agentName}`
  const logGroupPrefix =
    process.env.MC_AGENT_LOG_GROUP_PREFIX || `/ecs/${clusterName}`
  const logGroupName = `${logGroupPrefix}/companion-openclaw-${agentName}`
  const taskDefFamily = serviceName

  const deleted: DeletedResources = {}
  const warnings: Array<{ code: string; message: string }> = []
  // Captured during DescribeServices (step 1) so the catch block can
  // populate failedResources.serviceArn even when the failure
  // happens before DeleteService runs.
  let discoveredServiceArn: string | undefined

  try {
    // ================================================================
    // Step 1: DescribeServices — pre-flight existence + tag guard
    // ================================================================
    const describe = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
        include: ['TAGS'],
      }),
    )
    const target = describe.services?.[0]
    if (!target) {
      // Service entirely absent — initial not-found. 404.
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies DeleteAgentErrorResponse,
        { status: 404 },
      )
    }
    // Capture for the catch-block failure report — service was
    // discovered but not yet deleted. `deleted.serviceArn` is set
    // separately, only after DeleteService succeeds, so the
    // happy-path response means "actually deleted" not "found in
    // describe."
    discoveredServiceArn = target.serviceArn
    // INACTIVE handling: a prior DELETE that succeeded at
    // DeleteService but failed on a downstream step (e.g. the
    // log-group cleanup before the IAM grant in PR #262 applied)
    // leaves the ECS service INACTIVE while listener rules / TGs /
    // log groups still exist. 404'ing on retry would strand those
    // resources. Instead, treat INACTIVE as "ECS portion already
    // done" and continue the rest of the teardown idempotently.
    const serviceAlreadyDeleted = target.status === 'INACTIVE'
    if (!isAgentHarness(target)) {
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          actor: auth.user?.id,
        },
        '[fleet] delete-agent: refused — target is not an MC-managed agent harness',
      )
      logSecurityEvent({
        event_type: 'fleet.delete-agent.refused-non-harness',
        severity: 'warning',
        source: 'fleet',
        agent_name: agentName,
        detail: `actor=${auth.user?.id} service=${serviceName}`,
      })
      // 404 (not 403) — refuse to confirm the existence of a
      // non-harness service to a caller asking about it.
      return NextResponse.json(
        {
          error: 'ServiceNotFoundException',
          detail: `agent "${agentName}" not found`,
        } satisfies DeleteAgentErrorResponse,
        { status: 404 },
      )
    }

    // ================================================================
    // Step 2: UpdateService desiredCount=0 — drain
    // ================================================================
    if (!serviceAlreadyDeleted) {
      await ecsClient.send(
        new UpdateServiceCommand({
          cluster: clusterName,
          service: serviceName,
          desiredCount: 0,
        }),
      )
    } else {
      warnings.push({
        code: 'service-already-deleted',
        message: `Service ${serviceName} was already INACTIVE — skipped drain + delete; continuing with downstream resources`,
      })
    }

    // ================================================================
    // Step 3 + 4: Resolve listener rule ARN + DeleteRule
    // ================================================================
    const ruleArn = await findListenerRuleArn(sharedAlbName, agentName)
    if (ruleArn) {
      try {
        await elbv2Client.send(
          new DeleteRuleCommand({ RuleArn: ruleArn }),
        )
        deleted.listenerRuleArn = ruleArn
      } catch (err) {
        if (isErrorOfType(err, [...NOT_FOUND_NAMES.rule])) {
          warnings.push({
            code: 'listener-rule-already-deleted',
            message: `Listener rule ${ruleArn} was already gone`,
          })
        } else {
          throw err
        }
      }
    } else {
      warnings.push({
        code: 'listener-rule-not-found',
        message: `No listener rule for /agent/${agentName} on ${sharedAlbName}`,
      })
    }

    // ================================================================
    // Step 5 + 6: Resolve target group ARN + DeleteTargetGroup
    // ================================================================
    const tgArn = await findTargetGroupArn(tgName)
    if (tgArn) {
      try {
        await elbv2Client.send(
          new DeleteTargetGroupCommand({ TargetGroupArn: tgArn }),
        )
        deleted.targetGroupArn = tgArn
      } catch (err) {
        if (isErrorOfType(err, [...NOT_FOUND_NAMES.targetGroup])) {
          warnings.push({
            code: 'target-group-already-deleted',
            message: `Target group ${tgName} was already gone`,
          })
        } else {
          throw err
        }
      }
    } else {
      warnings.push({
        code: 'target-group-not-found',
        message: `No target group named ${tgName}`,
      })
    }

    // ================================================================
    // Step 7: Deregister all ACTIVE task-def revisions
    // ================================================================
    // `familyPrefix` is a PREFIX match, not an exact family name —
    // querying for `bot` would return revisions for both `bot` and
    // `bot-test`. Filter the returned ARNs back to the EXACT family
    // before deregistering, otherwise a delete on a short-named agent
    // could deregister another agent's task-defs. The ARN format is
    // `arn:...:task-definition/{family}:{revision}`, so split on `/`
    // and strip the trailing `:{revision}` to extract the family.
    const deregistered: string[] = []
    let tdMarker: string | undefined
    do {
      const page = await ecsClient.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: taskDefFamily,
          status: 'ACTIVE',
          nextToken: tdMarker,
        }),
      )
      for (const arn of page.taskDefinitionArns ?? []) {
        const familyOfArn = arn.split('/').pop()?.replace(/:\d+$/, '')
        if (familyOfArn !== taskDefFamily) continue
        try {
          await ecsClient.send(
            new DeregisterTaskDefinitionCommand({ taskDefinition: arn }),
          )
          deregistered.push(arn)
        } catch (err) {
          if (isErrorOfType(err, [...NOT_FOUND_NAMES.taskDef])) {
            warnings.push({
              code: 'task-def-deregister-skipped',
              message: `Task-def ${arn} already INACTIVE`,
            })
          } else {
            throw err
          }
        }
      }
      tdMarker = page.nextToken
    } while (tdMarker)
    if (deregistered.length > 0) {
      deleted.taskDefinitionRevisions = deregistered
    }

    // ================================================================
    // Step 8: DeleteService force=true
    // ================================================================
    if (!serviceAlreadyDeleted) {
      try {
        await ecsClient.send(
          new DeleteServiceCommand({
            cluster: clusterName,
            service: serviceName,
            force: true,
          }),
        )
        deleted.serviceArn = discoveredServiceArn
      } catch (err) {
        if (isErrorOfType(err, [...NOT_FOUND_NAMES.service])) {
          warnings.push({
            code: 'service-already-deleted',
            message: `Service ${serviceName} was already gone`,
          })
        } else {
          throw err
        }
      }
    }

    // ================================================================
    // Step 9: DeleteLogGroup (last, so awslogs driver flushes tail)
    // ================================================================
    try {
      await logsClient.send(
        new DeleteLogGroupCommand({ logGroupName }),
      )
      deleted.logGroup = logGroupName
    } catch (err) {
      if (isErrorOfType(err, [...NOT_FOUND_NAMES.logGroup])) {
        warnings.push({
          code: 'log-group-already-deleted',
          message: `Log group ${logGroupName} was already gone`,
        })
      } else {
        throw err
      }
    }

    logSecurityEvent({
      event_type: 'fleet.delete-agent.success',
      severity: 'info',
      source: 'fleet',
      agent_name: agentName,
      detail: `actor=${auth.user?.id} resources=${JSON.stringify(deleted)}`,
    })

    return NextResponse.json(
      {
        ok: true,
        agentName,
        deletedResources: deleted,
        warnings,
      } satisfies DeleteAgentResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const error = err as { name?: string; message?: string }
    logger.error(
      {
        cluster: clusterName,
        serviceName,
        agentName,
        deletedSoFar: deleted,
        errorName: error.name,
        errorMessage: error.message,
      },
      '[fleet] delete-agent: AWS error during teardown',
    )
    // failedResources = the inverse of deletedResources (what we tried
    // to delete but didn't succeed at). Operator gets the list to do
    // manual cleanup.
    const failed: DeletedResources = {}
    if (!deleted.listenerRuleArn) {
      failed.listenerRuleArn = `(unknown — for /agent/${agentName} on ${sharedAlbName})`
    }
    if (!deleted.targetGroupArn) {
      failed.targetGroupArn = `(unknown — name ${tgName})`
    }
    if (!deleted.logGroup) failed.logGroup = logGroupName
    if (!deleted.taskDefinitionRevisions) {
      failed.taskDefinitionRevisions = [`(family ${taskDefFamily}, all ACTIVE revisions)`]
    }
    if (!deleted.serviceArn) {
      failed.serviceArn = discoveredServiceArn ?? serviceName
    }
    return NextResponse.json(
      {
        error: error.name || 'AWSError',
        deletedResources: deleted,
        failedResources: failed,
      } satisfies DeleteAgentErrorResponse,
      { status: 502 },
    )
  }
}

/**
 * Find the listener rule ARN for /agent/{agentName} on the shared agents
 * ALB. Returns null if no matching rule exists (idempotent path).
 *
 * Pagination: DescribeRules caps at 100/page; with the shared ALB
 * potentially hosting many agents, we iterate to find the one whose
 * path-pattern condition matches the requested agent. Same pagination
 * shape as agents.ts::allocatePriority.
 */
async function findListenerRuleArn(
  sharedAlbName: string,
  agentName: string,
): Promise<string | null> {
  const lbResp = await elbv2Client.send(
    new DescribeLoadBalancersCommand({ Names: [sharedAlbName] }),
  )
  const lb = lbResp.LoadBalancers?.[0]
  if (!lb?.LoadBalancerArn) return null

  const listenersResp = await elbv2Client.send(
    new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn }),
  )
  // Mirror the CREATE handler's listener selection (agents.ts) — pick
  // the HTTP listener explicitly. When an HTTPS:443 listener is added
  // to the shared ALB (post-ACM-Private-CA), Listeners[0] would
  // sometimes return the HTTPS listener (AWS doesn't guarantee
  // ordering by port), causing DELETE to scan the wrong listener,
  // miss the rule, and silently leave the HTTP rule as a dangling
  // resource. Filter must stay in sync with the CREATE handler.
  const listener = listenersResp.Listeners?.find((l) => l.Protocol === 'HTTP')
  if (!listener?.ListenerArn) return null

  const targetPath = `/agent/${agentName}`
  let marker: string | undefined
  do {
    const page = await elbv2Client.send(
      new DescribeRulesCommand({
        ListenerArn: listener.ListenerArn,
        Marker: marker,
      }),
    )
    for (const rule of page.Rules ?? []) {
      const matches = (rule.Conditions ?? []).some(
        (c) =>
          c.Field === 'path-pattern' &&
          (c.Values ?? []).some((v) => v === targetPath),
      )
      if (matches && rule.RuleArn) return rule.RuleArn
    }
    marker = page.NextMarker
  } while (marker)
  return null
}

/**
 * Find the target group ARN by name. ELBv2 names are unique per region
 * + account, so this is an O(1) lookup. Returns null on
 * TargetGroupNotFound (idempotent path).
 */
async function findTargetGroupArn(tgName: string): Promise<string | null> {
  try {
    const resp = await elbv2Client.send(
      new DescribeTargetGroupsCommand({ Names: [tgName] }),
    )
    return resp.TargetGroups?.[0]?.TargetGroupArn ?? null
  } catch (err) {
    if (isErrorOfType(err, [...NOT_FOUND_NAMES.targetGroup])) return null
    throw err
  }
}
