import { z } from 'zod'
import { jevAssistantDraftSchema } from '@/lib/jev-assistant-schema'

const text = { type: 'string' } as const
const list = { type: 'array', items: text } as const
const object = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
})

// Both APIs require closed objects. Question maps are assembled only after validation.
export const JEV_API_DRAFT_SCHEMA = object({
  summary: text, name: text, description: text,
  questions: { type: 'array', items: object({
    id: text, type: { type: 'string', enum: ['noul', 'choice', 'score'] }, instructions: text,
    positive: text, negative: text,
    options: { type: 'array', items: object({ id: text, description: text }) }, levels: list,
  }) },
  tests: list, risks: list, observability: list, warnings: list,
  clarifications: { type: 'array', items: object({
    id: text, title: text, help: text,
    options: { type: 'array', items: object({
      value: text, label: text, consequence: text, recommended: { type: 'boolean' },
    }) },
  }) },
})

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine((id) => !['constructor', 'prototype', '__proto__'].includes(id))
const question = z.object({
  id: identifier, type: z.enum(['noul', 'choice', 'score']),
  instructions: z.string().trim().min(1).max(4000),
  positive: z.string().max(4000), negative: z.string().max(4000),
  options: z.array(z.object({ id: identifier, description: z.string().trim().min(1).max(4000) }).strict()).max(8),
  levels: z.array(z.string().trim().min(1).max(4000)).max(10),
}).strict().superRefine((value, context) => {
  if ((value.type === 'choice' && value.options.length < 2) || (value.type === 'score' && value.levels.length < 2)) {
    context.addIssue({ code: 'custom', message: 'At least two options or levels are required' })
  }
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length) {
    context.addIssue({ code: 'custom', message: 'Option IDs must be unique' })
  }
  if ((value.type !== 'choice' && value.options.length) || (value.type !== 'score' && value.levels.length)
    || (value.type !== 'noul' && (value.positive || value.negative))) {
    context.addIssue({ code: 'custom', message: 'Only criteria for the chosen type may be filled' })
  }
})

const wireDraft = jevAssistantDraftSchema.omit({ questions: true }).extend({
  questions: z.array(question).min(1).max(6).refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length, 'Question IDs must be unique',
  ),
}).strict()

export function parseJevApiDraft(value: unknown) {
  const draft = wireDraft.parse(value)
  const questions = Object.fromEntries(draft.questions.map((item) => [item.id, {
    type: item.type, instructions: item.instructions,
    criteria: item.type === 'choice' ? Object.fromEntries(item.options.map((option) => [option.id, option.description]))
      : item.type === 'score' ? item.levels : { true: item.positive || null, false: item.negative || null },
  }]))
  return jevAssistantDraftSchema.parse({ ...draft, questions })
}
