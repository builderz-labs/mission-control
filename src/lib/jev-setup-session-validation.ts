import { z } from 'zod'
import { jevAssistantRequestSchema } from './jev-assistant-schema'

const provider = z.string().trim().min(1).max(40)
const model = z.string().trim().min(1).max(80)

export const createJevSetupSessionSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  provider: provider.default('claude-cli'),
  model: model.default('haiku'),
  primaryPolicyId: z.number().int().positive().nullable().optional(),
  initialInput: z.object({
    goal: jevAssistantRequestSchema.shape.goal,
    answers: jevAssistantRequestSchema.shape.answers,
    projectIds: jevAssistantRequestSchema.shape.projectIds,
  }).strict().optional(),
}).strict()

export const updateJevSetupSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  provider: provider.optional(),
  model: model.optional(),
  status: z.enum(['draft', 'ready']).optional(),
  primaryPolicyId: z.number().int().positive().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one update is required')

export type CreateJevSetupSessionInput = z.infer<typeof createJevSetupSessionSchema>
export type UpdateJevSetupSessionInput = z.infer<typeof updateJevSetupSessionSchema>
