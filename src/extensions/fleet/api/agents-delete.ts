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
import { AGENT_NAME_DELETE_RE } from '@/extensions/fleet/templates/constraints'
import { resolveFleetPrefix } from '@/extensions/fleet/lib/fleet-prefix'
import { isAgentHarness } from '@/extensions/fleet/lib/ecs-guards'
import {
  getLiteLLMMasterKey,
  deleteAgentLiteLLMKey,
} from '@/extensions/fleet/lib/secrets-manager'
import { deleteAgentRoles, roleNames } from '@/extensions/fleet/lib/iam-roles'
import {
  LiteLLMManagementClient,
  LiteLLMManagementError,
} from '@/extensions/litellm/management'

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
 *   1. DescribeServices → 404 if the service EXISTS but isn't an
 *      agent-harness; if the service is absent or INACTIVE, skip
 *      drain + DeleteService and continue the idempotent teardown (#478)
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
 *   - **404**: service EXISTS but isn't an MC-managed agent harness —
 *     refusing to confirm the existence of a non-harness service to a
 *     caller asking about it. An entirely-absent service does NOT 404
 *     (#478): it returns 200 with `service-not-found` in `warnings`
 *     after the idempotent downstream teardown.
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
  /** #354: LiteLLM virtual-key alias that was revoked via /key/delete. */
  litellmKeyAlias?: string
  /** #354: Secrets Manager secret name scheduled for deletion. */
  litellmSecretName?: string
  /**
   * #134: Names of per-agent IAM roles touched in step 12. On
   * `deletedResources`, only roles that were actually present (not
   * in `alreadyDeleted`) appear here. On `failedResources` (outer
   * catch fires before step 12), both deterministic names appear
   * regardless of whether the agent was created post-#134 — for
   * legacy shared-role agents (pre-#134) these names refer to
   * roles that never existed, in which case the operator may see
   * NoSuchEntity from a manual lookup. Operationally benign;
   * tracked as a known pre-#134 artifact until shared-role
   * retirement.
   */
  iamRolesDeleted?: string[]
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
  // Narrow auth.user after the guard. The `'user' in auth` form
  // gives TS the same narrowing the `'error' in auth` guard above
  // did; using `auth.user?.id` here would produce `undefined` on
  // an unreachable path and silently strip the actor from audit
  // entries (the agents.ts create handler uses this same form).
  const actor = 'user' in auth ? auth.user.id : undefined

  const { name: agentName } = await params

  // Backward-compatible regex on the legacy 3-32 range — see
  // AGENT_NAME_DELETE_RE in templates/constraints.ts for the
  // CREATE-vs-DELETE asymmetry rationale. Same character-set
  // anchoring + load-bearing path-segment guard (rejects `..` and
  // anything outside `[a-z0-9-]`), just relaxed on the upper length
  // bound so agents created before AGENT_NAME_RE tightened to 3-20
  // remain teardown-eligible through the API. The IAM grants on
  // ECS/ELBv2/Logs delete verbs are scoped to ARN patterns derived
  // from this regex; the legacy 32-char names already fit those
  // patterns.
  if (!agentName || !AGENT_NAME_DELETE_RE.test(agentName)) {
    return NextResponse.json(
      {
        error: 'InvalidAgentName',
        detail: `agentName must match ${AGENT_NAME_DELETE_RE.source}`,
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
  // Hoisted so the catch block can tell "service proven absent" (#478)
  // from "service existed but a later step failed" when building
  // failedResources.
  let serviceWasAbsent = false

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
    // AWS reports an absent service in `failures[].reason='MISSING'`,
    // not in `services[]`. Either way `!target` correctly identifies
    // the absent case below, so `failures` is intentionally not
    // inspected for this gate.
    const target = describe.services?.[0]
    // `serviceAlreadyDeleted` covers two "ECS portion already done"
    // cases; both skip drain (step 2) + DeleteService (step 8) and
    // continue the idempotent teardown of every downstream resource:
    //   1. INACTIVE — a prior DELETE succeeded at DeleteService but
    //      failed on a downstream step (e.g. log-group cleanup before
    //      the IAM grant in PR #262 applied), leaving listener rules /
    //      TGs / log groups behind. 404'ing on retry would strand them.
    //   2. Entirely absent (#478) — the service was partially created
    //      (never came up) or a fully-torn-down agent is being
    //      re-deleted. The old early 404 here stranded every other
    //      resource; instead treat the missing service as a no-op.
    let serviceAlreadyDeleted = false
    serviceWasAbsent = !target
    if (!target) {
      // Service entirely absent (#478). The isAgentHarness tag guard
      // below cannot run — there are no service tags to inspect — so
      // it is skipped on this path. Safe: the endpoint is admin-gated
      // (requireRole('admin')), every resource name derives from
      // `agentName` (which passed AGENT_NAME_DELETE_RE), all names are
      // fleet-prefix-scoped, and the IAM delete grants are scoped to
      // ARN patterns from that regex — so an absent-service delete can
      // only ever touch this agent's own deterministically-named
      // resources, never an arbitrary service.
      serviceAlreadyDeleted = true
    } else {
      // Capture for the catch-block failure report — service was
      // discovered but not yet deleted. `deleted.serviceArn` is set
      // separately, only after DeleteService succeeds, so the
      // happy-path response means "actually deleted" not "found in
      // describe."
      discoveredServiceArn = target.serviceArn
      serviceAlreadyDeleted = target.status === 'INACTIVE'
      if (!isAgentHarness(target)) {
        logger.warn(
          {
            cluster: clusterName,
            serviceName,
            actor,
          },
          '[fleet] delete-agent: refused — target is not an MC-managed agent harness',
        )
        logSecurityEvent({
          event_type: 'fleet.delete-agent.refused-non-harness',
          severity: 'warning',
          source: 'fleet',
          agent_name: agentName,
          detail: `actor=${actor} service=${serviceName}`,
        })
        // 404 (not 403) — refuse to confirm the existence of a
        // non-harness service to a caller asking about it. NOTE: this
        // refusal only applies when the service EXISTS but isn't an
        // MC-managed harness; an entirely-absent service takes the
        // continue-teardown path above.
        return NextResponse.json(
          {
            error: 'ServiceNotFoundException',
            detail: `agent "${agentName}" not found`,
          } satisfies DeleteAgentErrorResponse,
          { status: 404 },
        )
      }
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
    } else if (serviceWasAbsent) {
      warnings.push({
        code: 'service-not-found',
        message: `Service ${serviceName} did not exist — skipped drain + delete; continuing with downstream resources (listener rule, target group, log group, task-defs, LiteLLM key, secret, IAM roles)`,
      })
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

    // ================================================================
    // Step 10: Revoke per-agent LiteLLM virtual key (#354)
    // ================================================================
    // Order matters (round-2 audit, Greptile P1 "Key revoked too
    // early"): revoke AFTER the AWS surface is verified gone. If
    // /key/delete ran before DeleteService and DeleteService then
    // failed, the agent would remain partially alive with a revoked
    // model key — unable to recover.
    //
    // Sequence:
    //   a. Resolve master key from Secrets Manager (MC's task role
    //      grant `SecretsManagerReadLiteLLMMasterKey`).
    //   b. POST /key/delete on the LiteLLM proxy with the
    //      deterministic alias `{prefix}-{agent}` — same alias used
    //      at create-agent time so the delete identifies the key
    //      without reading the per-agent secret first.
    //   c. 404 / network failure / missing master key → warning,
    //      continue. The agent's AWS footprint is already gone;
    //      leaving a dangling LiteLLM key is a lesser harm than
    //      blocking the delete response on a transient proxy hiccup.
    //
    // The boolean `litellmKeyRevoked` gates step 11 (SM secret
    // deletion): if revoke fails the secret must survive so an
    // operator can read the key value and revoke manually (round-2
    // audit, Greptile P1 "Secret deleted after failed revoke").
    //
    // Env vars (MC_LITELLM_MASTER_KEY_SECRET_ARN,
    // MC_LITELLM_ALB_DNS_NAME) are NOT validated upfront like in
    // the create-agent path — a delete should still proceed and
    // clean up AWS resources even if the LiteLLM proxy is
    // misconfigured / offline.
    const litellmKeyAlias = `${prefix}-${agentName}`
    // Direct env reads here (vs. resolveEnv() like the create handler)
    // are intentional: delete is best-effort soft-fail on missing
    // LiteLLM config, while create requires both vars at request-
    // validation time. Routing through resolveEnv would either force
    // mandatory env (breaking delete-without-LiteLLM) or duplicate
    // the soft-fail conditional inside the resolver — neither cleaner
    // than the explicit reads. Round-5 audit acknowledged.
    const litellmMasterKeyArn = process.env.MC_LITELLM_MASTER_KEY_SECRET_ARN
    const litellmAlbDnsName = process.env.MC_LITELLM_ALB_DNS_NAME
    let litellmKeyRevoked = false
    if (litellmMasterKeyArn && litellmAlbDnsName) {
      try {
        const masterKey = await getLiteLLMMasterKey(litellmMasterKeyArn)
        // http:// is intentional — internal-only ALB; see
        // matching comment in agents.ts step 0.5 (which also
        // documents the IAM mitigating control:
        // SecretsManagerReadLiteLLMMasterKey is on the MC task
        // role only, not on companion-agent tasks).
        const litellmClient = new LiteLLMManagementClient(
          `http://${litellmAlbDnsName}`,
          masterKey,
        )
        const result = await litellmClient.deleteKey({
          alias: litellmKeyAlias,
        })
        litellmKeyRevoked = true
        // Align `deleted.litellmKeyAlias` semantics with the AWS-resource
        // "already-deleted" handling (rule, TG, log group): the field is
        // only populated when *this* DELETE actually revoked the key.
        // Operator-visible signal: `deletedResources.litellmKeyAlias`
        // present ⇒ this call did the revoke; absent + warning code
        // `litellm-key-already-deleted` ⇒ key was gone already.
        if (result.alreadyDeleted) {
          warnings.push({
            code: 'litellm-key-already-deleted',
            message: `LiteLLM virtual key with alias '${litellmKeyAlias}' was already gone`,
          })
        } else {
          deleted.litellmKeyAlias = litellmKeyAlias
        }
      } catch (err) {
        // Non-fatal — surface the failure as a warning + continue.
        // litellmKeyRevoked stays false so step 11 skips secret
        // deletion. Operators can read the key value from the
        // surviving secret and revoke manually via the LiteLLM
        // dashboard.
        const errName = (err as { name?: string })?.name ?? 'UnknownError'
        const isLiteLLMErr = err instanceof LiteLLMManagementError
        warnings.push({
          code: 'litellm-key-revoke-failed',
          message:
            `Could not revoke LiteLLM virtual key '${litellmKeyAlias}' (${errName}` +
            (isLiteLLMErr ? ` status=${err.status}` : '') +
            '). Per-agent secret left in place so operators can revoke manually via the LiteLLM dashboard.',
        })
        logger.warn(
          {
            cluster: clusterName,
            serviceName,
            litellmKeyAlias,
            errorName: errName,
          },
          '[fleet] delete-agent: LiteLLM /key/delete failed (continuing, secret retained)',
        )
      }
    } else if (!litellmMasterKeyArn && !litellmAlbDnsName) {
      // Both unset: this MC instance manages no LiteLLM keys at all.
      // The per-agent secret (if it exists) is orphaned from a
      // different MC configuration and safe to delete. Skip revoke,
      // allow step 11 to clean up.
      litellmKeyRevoked = true
      warnings.push({
        code: 'litellm-key-revoke-skipped',
        message:
          'Skipped LiteLLM /key/delete: both MC_LITELLM_MASTER_KEY_SECRET_ARN and MC_LITELLM_ALB_DNS_NAME are unset, ' +
          'so this MC instance does not manage LiteLLM keys. ' +
          'If this deployment SHOULD manage LiteLLM keys, STOP and set both env vars before re-running DELETE — ' +
          'otherwise the per-agent SM secret will be removed while the live LiteLLM key (if any) keeps draining budget. ' +
          'Proceeding under the no-LiteLLM-proxy assumption.',
      })
    } else {
      // Round-4 audit (Claude C2): asymmetric env-var configuration —
      // exactly one of the two is set. Treat this as a misconfig and
      // PRESERVE the SM secret (litellmKeyRevoked stays false so
      // step 11 skips deletion). Without this branch, the prior
      // shape destroyed the secret here without revoking the key —
      // losing the operator's recovery path.
      const which = !litellmMasterKeyArn
        ? 'MC_LITELLM_MASTER_KEY_SECRET_ARN'
        : 'MC_LITELLM_ALB_DNS_NAME'
      warnings.push({
        code: 'litellm-key-revoke-config-incomplete',
        message:
          `LiteLLM revoke skipped: ${which} is unset while the other LiteLLM env var is set. ` +
          `Per-agent secret retained — fix the env, then re-run DELETE or revoke key alias '${litellmKeyAlias}' manually.`,
      })
      logger.warn(
        {
          cluster: clusterName,
          serviceName,
          missingEnv: which,
        },
        '[fleet] delete-agent: LiteLLM env partially configured; preserving SM secret',
      )
    }

    // ================================================================
    // Step 11: Schedule deletion of per-agent LiteLLM secret (#354)
    // ================================================================
    // Uses a 7-day recovery window — an accidental delete can be
    // restored before SM permanently destroys the secret. Gated on
    // step 10 success: if the LiteLLM key revoke failed, the secret
    // is retained so operators can read its value to revoke
    // manually (round-2 audit, Greptile P1).
    //
    // All failures (including PendingDeletion idempotent-second-
    // delete) → warning + continue. The handler returns 200 even
    // if step 11 warns — the AWS surface is gone, the SM-side
    // leftover is bounded and recoverable.
    if (litellmKeyRevoked) {
      // Round-3 audit: short-circuit if MC_AGENT_SECRETS_NAME_PREFIX
      // is unset. deleteAgentLiteLLMKey would throw ConfigurationError
      // which surfaces as an opaque "litellm-secret-delete-failed
      // (ConfigurationError)" warning. Catch the misconfig up-front
      // with a clearer code.
      if (!process.env.MC_AGENT_SECRETS_NAME_PREFIX) {
        warnings.push({
          code: 'litellm-secret-delete-skipped-no-prefix',
          message:
            'MC_AGENT_SECRETS_NAME_PREFIX is unset — no per-agent SM secret can be located. ' +
            'If a litellm-key secret exists for this agent under a different prefix, delete it manually.',
        })
      } else {
        try {
          const result = await deleteAgentLiteLLMKey(agentName)
          // Aligned with step 10's `deleted.litellmKeyAlias` suppression
          // (round-3 audit) + the AWS-resource already-deleted pattern
          // (rule / TG / log group): present in deletedResources ⇒
          // this call did the delete; absent + `litellm-secret-
          // already-deleted` warning ⇒ secret was already gone.
          if (result.alreadyDeleted) {
            warnings.push({
              code: 'litellm-secret-already-deleted',
              message: `LiteLLM virtual-key secret for ${agentName} was already gone`,
            })
          } else {
            deleted.litellmSecretName = result.secretName
          }
        } catch (err) {
          const errName = (err as { name?: string })?.name ?? 'UnknownError'
          warnings.push({
            code: 'litellm-secret-delete-failed',
            message:
              `Could not schedule deletion of LiteLLM virtual-key secret for ${agentName} (${errName}). ` +
              `Run \`aws secretsmanager delete-secret --secret-id <name>\` manually to finish cleanup.`,
          })
          logger.warn(
            { agentName, errorName: errName },
            '[fleet] delete-agent: SM DeleteSecret for litellm key failed (continuing)',
          )
        }
      }
    } else {
      warnings.push({
        code: 'litellm-secret-delete-skipped',
        message:
          `LiteLLM virtual-key secret for ${agentName} was retained because the /key/delete revoke failed. ` +
          'After revoking the key manually via the LiteLLM dashboard, delete the secret with `aws secretsmanager delete-secret`.',
      })
    }

    // ================================================================
    // Step 12: Delete per-agent IAM task + execution roles (#134)
    // ================================================================
    // Runs last so any in-flight reference to the roles by AWS (e.g.,
    // ECS stopping the last task) is already gone. deleteAgentRoles
    // suppresses NoSuchEntity per-step, so a half-cleaned agent
    // (e.g., this step previously failed after deleting the inline
    // policy but before deleting the role) finishes idempotently on
    // re-run. Surfaces the alreadyDeleted list as a warning entry so
    // operators see which IAM resources were absent vs. fresh-deleted.
    const { taskRoleName, executionRoleName: execRoleName } = roleNames(
      prefix,
      agentName,
    )
    try {
      const iamResult = await deleteAgentRoles({ agentName, prefix })
      // Mirror the litellm-secret reporting shape (lines ~602-625):
      // `deleted.*` is populated only when the role was actually
      // present; a `*-already-deleted` warning covers the fully-
      // idempotent case. Avoids the ambiguous state where the
      // response says both "deleted X" AND "X was already gone".
      const taskAlreadyGone = iamResult.alreadyDeleted.includes(taskRoleName)
      const execAlreadyGone = iamResult.alreadyDeleted.includes(execRoleName)
      const freshDeleted: string[] = []
      if (!taskAlreadyGone) freshDeleted.push(taskRoleName)
      if (!execAlreadyGone) freshDeleted.push(execRoleName)
      if (freshDeleted.length > 0) {
        deleted.iamRolesDeleted = freshDeleted
      }
      if (taskAlreadyGone && execAlreadyGone) {
        warnings.push({
          code: 'iam-roles-already-deleted',
          message: `Per-agent IAM roles for ${agentName} were already absent (idempotent path).`,
        })
      } else if (iamResult.alreadyDeleted.length > 0) {
        warnings.push({
          code: 'iam-roles-partially-already-gone',
          message:
            `Some per-agent IAM sub-resources were already absent (idempotent path): ${iamResult.alreadyDeleted.join(', ')}.`,
        })
      }
    } catch (err) {
      // Non-fatal — agent's AWS surface is gone at this point.
      // Surface the failure and continue; operator can finish IAM
      // cleanup manually via `aws iam delete-role-policy` +
      // `aws iam delete-role`.
      const errName = (err as { name?: string })?.name ?? 'UnknownError'
      warnings.push({
        code: 'iam-roles-delete-failed',
        message:
          `Could not delete per-agent IAM roles for ${agentName} (${errName}). ` +
          'Detach AmazonECSTaskExecutionRolePolicy from the exec role, then delete inline ' +
          `policies + roles manually: ${taskRoleName} and ${execRoleName}.`,
      })
      logger.warn(
        { agentName, errorName: errName },
        '[fleet] delete-agent: IAM role cleanup failed (continuing)',
      )
    }

    // Audit logging is best-effort — a SQLite hiccup must not turn a
    // fully-successful teardown into a 502 via the outer catch. The
    // create handler wraps its corresponding logSecurityEvent call
    // for exactly this reason (agents.ts ~line 1072).
    try {
      logSecurityEvent({
        event_type: 'fleet.delete-agent.success',
        severity: 'info',
        source: 'fleet',
        agent_name: agentName,
        detail: `actor=${actor} resources=${JSON.stringify(deleted)}`,
      })
    } catch (auditErr) {
      logger.warn(
        { err: auditErr, agentName },
        '[fleet] delete-agent: audit log write failed (best-effort; CloudWatch entry above is the authoritative record)',
      )
    }

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
    // Don't list the service as a failed resource when DescribeServices
    // already proved it absent (#478): the handler intentionally skipped
    // service deletion, so a 502 from a later step must not tell the
    // operator to clean up a service that never existed.
    if (!deleted.serviceArn && !serviceWasAbsent) {
      failed.serviceArn = discoveredServiceArn ?? serviceName
    }
    // #134: When the outer catch fires (an AWS error in steps 1-11),
    // step 12 (IAM cleanup) never runs. The role pair is deterministic
    // by name so an operator can clean up manually, but they need a
    // signal in the response that it exists at all — otherwise an
    // unfamiliar reader sees the 502 listing ECS/ELB/CW resources and
    // misses the IAM orphan entirely. Surface the deterministic names.
    if (!deleted.iamRolesDeleted) {
      const names = roleNames(prefix, agentName)
      failed.iamRolesDeleted = [names.taskRoleName, names.executionRoleName]
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
