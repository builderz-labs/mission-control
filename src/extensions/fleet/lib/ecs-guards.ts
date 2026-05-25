/**
 * Shared ECS service guards for Fleet handlers.
 *
 * The two-tag check (`Component=agent-harness` AND
 * `ManagedBy=mission-control`) is the load-bearing security
 * boundary that prevents fleet endpoints from operating on
 * non-MC-managed services (platform services like
 * `mission-control` itself, the Terraform-bootstrapped smoke-test,
 * litellm, etc.).
 *
 * Originally inlined in `agents-delete.ts` (Beat 4c) and again in
 * `slack-manifest.ts` (Beat 5b.1). Extracted here per round-3 audit
 * on PR #47 — duplicated guard logic across endpoints would mean
 * a future tightening (e.g., adding a third tag, case-insensitive
 * comparison) needs to update N call sites with no compiler
 * enforcement. Single source of truth.
 *
 * Pure read of the input — no AWS calls, no env reads.
 */

import type { Service } from '@aws-sdk/client-ecs'
import type { Tag as Elbv2Tag } from '@aws-sdk/client-elastic-load-balancing-v2'

const HARNESS_TAG_KEY = 'Component'
const HARNESS_TAG_VALUE = 'agent-harness'
const MANAGED_BY_KEY = 'ManagedBy'
const MANAGED_BY_VALUE = 'mission-control'

/**
 * True if the service is an MC-managed agent harness — both tags
 * present with the expected values.
 *
 * - `Component=agent-harness` distinguishes agent harnesses from
 *   platform services (mission-control, litellm, langfuse, etc.).
 * - `ManagedBy=mission-control` distinguishes MC-created agents
 *   from Terraform-managed agents (notably the smoke-test, which
 *   has `ManagedBy=terraform`). The smoke-test is teardown-protected
 *   by Terraform state — fleet endpoints should not act on it.
 */
export function isAgentHarness(service: Service): boolean {
  const tags = service.tags ?? []
  const isHarness = tags.some(
    (t) => t.key === HARNESS_TAG_KEY && t.value === HARNESS_TAG_VALUE,
  )
  const isMcManaged = tags.some(
    (t) => t.key === MANAGED_BY_KEY && t.value === MANAGED_BY_VALUE,
  )
  return isHarness && isMcManaged
}

/**
 * Absent-service-path equivalent of {@link isAgentHarness}, applied to
 * an ELBv2 target group's tags (#480, ender-stack#480 Risk 2).
 *
 * On the delete-agent absent-service path there is no ECS service to
 * tag-check, so the {@link isAgentHarness} smoke-test protection can't
 * run. The create handler tags the per-agent target group with the same
 * `Component=agent-harness` + `ManagedBy=mission-control` pair it puts on
 * the service (see `renderTargetGroup` in templates/openclaw.ts), so a
 * surviving TG that carries both is provably MC-managed. A Terraform-
 * managed agent's TG carries `ManagedBy=terraform` and is refused —
 * preventing an API teardown from clobbering TF-owned downstream
 * resources when a TF service is transiently absent.
 *
 * NOTE the casing difference: ELBv2 tags use `Key`/`Value`, ECS tags use
 * `key`/`value`. Same tag VALUES, centralized here, different field case.
 *
 * Pure read of the input — no AWS calls, no env reads.
 */
export function isAgentHarnessElbv2Tags(
  tags: Elbv2Tag[] | undefined,
): boolean {
  const t = tags ?? []
  const isHarness = t.some(
    (x) => x.Key === HARNESS_TAG_KEY && x.Value === HARNESS_TAG_VALUE,
  )
  const isMcManaged = t.some(
    (x) => x.Key === MANAGED_BY_KEY && x.Value === MANAGED_BY_VALUE,
  )
  return isHarness && isMcManaged
}
