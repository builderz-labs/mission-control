import { describe, expect, it } from 'vitest'
import { jevAssistantDraftSchema, jevAssistantRequestSchema } from '@/lib/jev-assistant-schema'

const draft = {
  summary: 'A safe summary', name: 'Release review', description: 'Review release evidence',
  questions: { decision: { type: 'choice', instructions: 'Choose the outcome', criteria: { approve: 'Ready', revise: 'Needs changes' } } },
  tests: ['Schema contract'], risks: ['Incomplete evidence'], observability: ['Latency and model'], warnings: [],
}

describe('Jev assistant schemas', () => {
  it('accepts a bounded typed draft', () => {
    expect(jevAssistantDraftSchema.parse(draft).questions).toHaveProperty('decision')
  })

  it('rejects model attempts to add activation or identity fields', () => {
    expect(jevAssistantDraftSchema.safeParse({ ...draft, approved: true, workspaceId: 2 }).success).toBe(false)
  })

  it('rejects reserved question identifiers and incomplete revisions', () => {
    expect(jevAssistantDraftSchema.safeParse({ ...draft, questions: { __proto__: { type: 'noul', instructions: 'Unsafe' } } }).success).toBe(false)
    expect(jevAssistantRequestSchema.safeParse({ action: 'revise', goal: 'Revise this', answers: {}, projectIds: [] }).success).toBe(false)
  })

  it('requires at least one authenticated repository target', () => {
    expect(jevAssistantRequestSchema.safeParse({
      action: 'draft', goal: 'Review this', answers: {}, projectIds: [],
    }).success).toBe(false)
  })

  it('caps setup answers and total request size', () => {
    const answers = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`answer${index}`, 'x']))
    expect(jevAssistantRequestSchema.safeParse({ action: 'draft', goal: 'Review this', answers, projectIds: [] }).success).toBe(false)
    expect(jevAssistantRequestSchema.safeParse({ action: 'draft', goal: 'x'.repeat(10_001), answers: {}, projectIds: [] }).success).toBe(false)
  })
})
