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
