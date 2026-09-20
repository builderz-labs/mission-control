import { z } from 'zod'
import type { EntryType, JsonValue } from '@typesafe-ai/sdk'
import type { JevQuestions, JevState } from '@/lib/jev-types'

const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(),
  z.array(jsonValue), z.record(z.string(), jsonValue),
])) as z.ZodType<JsonValue>

const entry = z.union([
  z.string().min(1).max(100_000),
  z.array(jsonValue).max(10_000),
  z.record(z.string(), jsonValue),
]) as z.ZodType<JevState>

const instructions: z.ZodType<EntryType> = entry
const criterion: z.ZodType<EntryType> = z.union([entry, z.null()])

const noulQuestion = z.object({
  type: z.literal('noul'),
  instructions,
  criteria: z.object({ true: criterion.optional(), false: criterion.optional() })
    .strict().nullable().optional(),
}).strict()

const choiceQuestion = z.object({
  type: z.literal('choice'),
  instructions,
  criteria: z.record(z.string().min(1).max(80), criterion),
}).strict().superRefine((value, context) => {
  const count = Object.keys(value.criteria).length
  if (count < 2 || count > 255) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Choice requires 2 to 255 options' })
  }
})

const scoreQuestion = z.object({
  type: z.literal('score'),
  instructions,
  criteria: z.array(entry).min(2).max(10),
}).strict()

export const jevQuestionsSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'Invalid question identifier'),
  z.discriminatedUnion('type', [noulQuestion, choiceQuestion, scoreQuestion]),
).superRefine((value, context) => {
  const count = Object.keys(value).length
  if (count < 1 || count > 50) {
    context.addIssue({ code: 'custom', message: 'Provide 1 to 50 questions' })
  }
}) as z.ZodType<JevQuestions>

export const createJevPolicySchema = z.object({
  projectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).optional().default(''),
  model: z.string().trim().min(1).max(80).default('jev-latest'),
  mode: z.enum(['manual', 'shadow']).default('shadow'),
  questions: jevQuestionsSchema,
  enabled: z.boolean().default(true),
}).strict()

export const updateJevPolicySchema = createJevPolicySchema.omit({ projectId: true })
  .partial().extend({ projectId: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== 'projectId'), 'At least one field is required')

export const runJevEvaluationSchema = z.object({
  projectId: z.number().int().positive(),
  policyId: z.number().int().positive().optional(),
  state: entry,
  questions: jevQuestionsSchema.optional(),
  model: z.string().trim().min(1).max(80).optional(),
  retainStatePreview: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (!value.policyId && !value.questions) {
    context.addIssue({ code: 'custom', message: 'A policyId or questions map is required' })
  }
  if (JSON.stringify(value.state).length > 200_000) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'State exceeds the 200 KB limit' })
  }
})
