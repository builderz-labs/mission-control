import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createJevPolicySchema, runJevEvaluationSchema } from '@/lib/jev-validation'

describe('Jev boundary validation', () => {
  it('accepts arbitrary unique Choice labels inside the documented bounds', () => {
    fc.assert(fc.property(
      fc.uniqueArray(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,12}$/),
        { minLength: 2, maxLength: 20 },
      ),
      (labels) => {
        const result = createJevPolicySchema.safeParse({
          projectId: 1,
          name: 'Classifier',
          questions: {
            classification: {
              type: 'choice',
              instructions: 'Choose the best label',
              criteria: Object.fromEntries(labels.map((label) => [label, null])),
            },
          },
        })
        expect(result.success).toBe(true)
      },
    ), { numRuns: 100 })
  })

  it.each([
    [{ type: 'choice', instructions: 'Pick', criteria: { only: null } }, 'Choice requires'],
    [{ type: 'score', instructions: 'Rate', criteria: ['only'] }, 'Too small'],
    [{ type: 'score', instructions: 'Rate', criteria: Array(11).fill('level') }, 'Too big'],
  ])('rejects malformed question contracts', (question, message) => {
    const result = createJevPolicySchema.safeParse({
      projectId: 1, name: 'Invalid', questions: { check: question },
    })
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain(message)
  })

  it('rejects question identifiers that could not round-trip safely', () => {
    const result = createJevPolicySchema.safeParse({
      projectId: 1, name: 'Invalid', questions: { 'bad id': { type: 'noul', instructions: 'Check' } },
    })
    expect(result.success).toBe(false)
  })

  it('requires a policy or ad-hoc questions and caps serialized state', () => {
    expect(runJevEvaluationSchema.safeParse({ projectId: 1, state: 'hello' }).success).toBe(false)
    expect(runJevEvaluationSchema.safeParse({
      projectId: 1, policyId: 1, state: 'x'.repeat(200_001),
    }).success).toBe(false)
  })
})
