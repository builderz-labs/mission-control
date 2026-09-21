import { z } from 'zod'
import { jevQuestionsSchema } from '@/lib/jev-validation'

const reservedClarifications = ['scope', 'answerType', 'trigger', 'enforcement', 'contextMode', 'failureMode', 'rollout', 'retention', 'validation', 'constructor', 'prototype', '__proto__']

const clarificationOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  consequence: z.string().trim().min(1).max(240),
  recommended: z.boolean().optional(),
}).strict()

export const jevClarificationSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/).refine((id) => !reservedClarifications.includes(id), 'Reserved clarification ID'),
  title: z.string().trim().min(1).max(160),
  help: z.string().trim().min(1).max(240),
  options: z.array(clarificationOptionSchema).min(2).max(4)
    .refine((options) => new Set(options.map((item) => item.value)).size === options.length, 'Options must be unique')
    .refine((options) => options.filter((item) => item.recommended).length <= 1, 'Choose at most one recommendation'),
}).strict()

export const jevAssistantDraftSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  questions: jevQuestionsSchema,
  tests: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  risks: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  observability: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8),
  clarifications: z.array(jevClarificationSchema).max(4).default([])
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Clarification IDs must be unique'),
}).strict()

export const jevAssistantRequestSchema = z.object({
  provider: z.enum(['claude-cli', 'anthropic', 'openai']).optional(),
  sessionId: z.string().uuid().optional(),
  action: z.enum(['draft', 'revise']).default('draft'),
  goal: z.string().trim().min(3).max(10_000),
  answers: z.record(z.string().max(40), z.string().trim().max(1_000))
    .refine((value) => Object.keys(value).length <= 20, 'Too many setup answers'),
  projectIds: z.array(z.number().int().positive()).min(1).max(100),
  currentDraft: jevAssistantDraftSchema.optional(),
  revision: z.string().trim().max(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'revise' && (!value.currentDraft || !value.revision)) {
    context.addIssue({ code: 'custom', message: 'A current draft and revision are required' })
  }
  if (JSON.stringify(value).length > 80_000) {
    context.addIssue({ code: 'custom', message: 'Assistant request exceeds the 80 KB limit' })
  }
})

export type JevAssistantDraft = z.infer<typeof jevAssistantDraftSchema>
export type JevAssistantRequest = z.infer<typeof jevAssistantRequestSchema>

export const JEV_ASSISTANT_OUTPUT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'name', 'description', 'questions', 'tests', 'risks', 'observability', 'warnings', 'clarifications'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', minLength: 1, maxLength: 1000 },
    questions: {
      type: 'object', minProperties: 1, maxProperties: 6,
      propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
      additionalProperties: {
        oneOf: [
          { type: 'object', additionalProperties: false, required: ['type', 'instructions'], properties: { type: { const: 'noul' }, instructions: { type: 'string' }, criteria: { type: ['object', 'null'], additionalProperties: false, properties: { true: { type: ['string', 'null'] }, false: { type: ['string', 'null'] } } } } },
          { type: 'object', additionalProperties: false, required: ['type', 'instructions', 'criteria'], properties: { type: { const: 'choice' }, instructions: { type: 'string' }, criteria: { type: 'object', minProperties: 2, maxProperties: 8, propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' }, additionalProperties: { type: 'string', minLength: 1 } } } },
          { type: 'object', additionalProperties: false, required: ['type', 'instructions', 'criteria'], properties: { type: { const: 'score' }, instructions: { type: 'string' }, criteria: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string', minLength: 1 } } } },
        ],
      },
    },
    tests: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 240 } },
    risks: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 240 } },
    observability: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 240 } },
    warnings: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    clarifications: {
      type: 'array', maxItems: 4, items: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'help', 'options'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          title: { type: 'string', minLength: 1, maxLength: 160 },
          help: { type: 'string', minLength: 1, maxLength: 240 },
          options: { type: 'array', minItems: 2, maxItems: 4, items: {
            type: 'object', additionalProperties: false,
            required: ['value', 'label', 'consequence'],
            properties: {
              value: { type: 'string', minLength: 1, maxLength: 80 },
              label: { type: 'string', minLength: 1, maxLength: 100 },
              consequence: { type: 'string', minLength: 1, maxLength: 240 },
              recommended: { type: 'boolean' },
            },
          } },
        },
      },
    },
  },
} as const
