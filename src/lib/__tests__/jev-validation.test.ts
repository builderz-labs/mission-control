import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  createJevPoliciesSchema,
  createJevPolicySchema,
  runJevEvaluationSchema,
  updateJevPolicySchema,
} from '@/lib/jev-validation'

const configuration = (projectIds: number[]) => ({
  scope: 'selected', projectIds, trigger: 'manual', enforcement: 'advisory',
  contextMode: 'safe_repository', failureMode: 'retry_then_review', rollout: 'shadow',
  retainPreview: false, uncertaintyThreshold: 0.65, tests: [], risks: [], observability: [],
})
const testUuid = (tail: number) => `00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`

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
      idempotencyKey: testUuid(1),
      projectId: 1, policyId: 1, state: 'x'.repeat(200_001),
    }).success).toBe(false)
  })

  it('requires a retry-safe idempotency key for every paid evaluation request', () => {
    const request = { projectId: 1, policyId: 1, state: 'hello' }
    expect(runJevEvaluationSchema.safeParse(request).success).toBe(false)
    expect(runJevEvaluationSchema.safeParse({
      ...request, idempotencyKey: testUuid(2),
    }).success).toBe(true)
  })

  it('requires persisted configuration targets to match policy targets exactly', () => {
    const policy = {
      name: 'Scoped', questions: { ready: { type: 'noul', instructions: 'Ready?' } },
    }
    expect(createJevPolicySchema.safeParse({
      ...policy, projectId: 1, configuration: configuration([2]),
    }).success).toBe(false)
    expect(updateJevPolicySchema.safeParse({
      projectId: 1, configuration: configuration([2]),
    }).success).toBe(false)
    expect(createJevPoliciesSchema.safeParse({
      ...policy, projectIds: [1, 2], configuration: configuration([2, 1]),
    }).success).toBe(true)
    expect(createJevPoliciesSchema.safeParse({
      ...policy, projectIds: [1, 2], configuration: configuration([1, 3]),
    }).success).toBe(false)
  })

  it('rejects oversized, deeply nested, and reserved generated schemas', () => {
    let nested: Record<string, unknown> = { value: 'end' }
    for (let index = 0; index < 14; index += 1) nested = { nested }
    const policy = (instructions: unknown, id = 'check') => ({
      projectId: 1, name: 'Bounded', questions: { [id]: { type: 'noul', instructions } },
    })
    expect(createJevPolicySchema.safeParse(policy('x'.repeat(60_001))).success).toBe(false)
    expect(createJevPolicySchema.safeParse(policy(nested)).success).toBe(false)
    expect(createJevPolicySchema.safeParse(policy('Check', 'constructor')).success).toBe(false)
  })
})
