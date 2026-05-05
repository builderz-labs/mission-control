import { describe, expect, it } from 'vitest'
import {
  approve,
  createRequest,
  reject,
  submitForReview,
} from '@/lib/request-gateway'

function makeInput(overrides: Partial<Parameters<typeof createRequest>[0]> = {}) {
  return {
    title: 'Add request gateway',
    description: 'Create a single lifecycle entry point for Mission Control requests.',
    risk_level: 1 as const,
    requested_by: 'nikma',
    target_area: 'mission-control',
    proposed_prompt: 'Wrap lifecycle transitions in a strict gateway.',
    validation_plan: 'pnpm typecheck && pnpm test && pnpm build',
    notes: 'Gateway only. No persistence or execution.',
    ...overrides,
  }
}

describe('request-gateway', () => {
  it('supports the valid flow DRAFT -> REVIEW_READY -> APPROVED', () => {
    const draft = createRequest(makeInput())
    const reviewReady = submitForReview(draft)
    const approved = approve(reviewReady)

    expect(draft.status).toBe('DRAFT')
    expect(reviewReady.status).toBe('REVIEW_READY')
    expect(approved.status).toBe('APPROVED')
  })

  it('throws on an invalid transition', () => {
    const draft = createRequest(makeInput())

    expect(() => approve(draft)).toThrow('Cannot approve request from status DRAFT.')
  })

  it('reject works from all valid states', () => {
    const draft = createRequest(makeInput())
    const reviewReady = submitForReview(draft)
    const approved = approve(reviewReady)

    expect(reject(draft, 'Needs refinement.').status).toBe('REJECTED')
    expect(reject(reviewReady, 'Needs review notes.').status).toBe('REJECTED')
    expect(reject(approved, 'Approval withdrawn.').status).toBe('REJECTED')
  })

  it('creation enforces validation', () => {
    expect(() => createRequest(makeInput({ title: '   ' }))).toThrow('Title is required.')
  })
})
