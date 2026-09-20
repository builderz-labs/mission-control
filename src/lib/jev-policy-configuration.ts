import { z } from 'zod'

export const scopeSchema = z.enum(['standalone', 'current', 'selected', 'all'])
export const triggerSchema = z.enum(['manual', 'pull_request', 'ci', 'release', 'scheduled', 'agent'])
export const enforcementSchema = z.enum(['advisory', 'review', 'blocking'])
export const contextModeSchema = z.enum(['pasted', 'safe_repository', 'metadata_only'])
export const failureModeSchema = z.enum(['hold_for_review', 'skip_and_continue', 'retry_then_review'])
export const rolloutSchema = z.enum(['sample', 'shadow', 'active'])

export const jevPolicyConfigurationSchema = z.object({
  scope: scopeSchema,
  projectIds: z.array(z.number().int().positive()).max(100),
  trigger: triggerSchema,
  enforcement: enforcementSchema,
  contextMode: contextModeSchema,
  failureMode: failureModeSchema,
  rollout: rolloutSchema,
  retainPreview: z.boolean(),
  uncertaintyThreshold: z.number().min(0.5).max(0.95),
  tests: z.array(z.string().trim().min(1).max(240)).max(8),
  risks: z.array(z.string().trim().min(1).max(240)).max(8),
  observability: z.array(z.string().trim().min(1).max(240)).max(8),
}).strict()

export type JevPolicyConfiguration = z.infer<typeof jevPolicyConfigurationSchema>
