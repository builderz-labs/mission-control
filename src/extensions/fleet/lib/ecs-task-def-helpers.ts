/**
 * ECS task-def manipulation helpers shared across fleet handlers
 * that mutate live task-defs (credentials POST, channels PUT,
 * future Phase-2.x flows).
 */

import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs'

/**
 * RegisterTaskDefinition only accepts the SUBSET of fields that
 * DescribeTaskDefinition returns. Strip the read-only fields that
 * AWS adds at registration time (taskDefinitionArn, revision,
 * status, requiresAttributes, compatibilities, registeredAt,
 * registeredBy, and deregisteredAt for already-INACTIVE revisions)
 * so the mutated spec round-trips cleanly. Without this,
 * RegisterTaskDef 400s with InvalidParameterException naming the
 * offending field.
 *
 * Extracted from slack-credentials.ts on ender-stack#283 so the
 * channels-only PUT handler can share the same logic.
 */
export function stripReadOnlyFields(
  td: Record<string, unknown>,
): RegisterTaskDefinitionCommandInput {
  const cleaned = { ...td }
  delete cleaned.taskDefinitionArn
  delete cleaned.revision
  delete cleaned.status
  delete cleaned.requiresAttributes
  delete cleaned.compatibilities
  delete cleaned.registeredAt
  delete cleaned.registeredBy
  delete cleaned.deregisteredAt
  return cleaned as unknown as RegisterTaskDefinitionCommandInput
}
