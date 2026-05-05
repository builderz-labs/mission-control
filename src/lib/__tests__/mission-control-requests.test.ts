import { describe, expect, it } from 'vitest'
import {
  approveRequest,
  createDraftRequest,
  markReviewReady,
  rejectRequest,
  validateRequest,
} from '@/lib/mission-control-requests'

function makeInput(overrides: Partial<Parameters<typeof createDraftRequest>[0]> = {}) {
  return {
    title: 'Add request queue foundation',
    description: 'Create a local-first draft workflow for Mission Control requests.',
    risk_level: 1 as const,
    requested_by: 'nikma',
    target_area: 'mission-control',
    proposed_prompt: 'Implement draft-only request lifecycle helpers.',
    validation_plan: 'pnpm typecheck && pnpm test && pnpm build',
    notes: 'Needs explicit review before any execution work.',
    ...overrides,
  }
}

describe('mission-control-requests', () => {
  it('creates valid draft', () => {
    const draft = createDraftRequest(makeInput())

    expect(draft.id).toMatch(/^mcr-/)
    expect(draft.status).toBe('DRAFT')
    expect(draft.risk_level).toBe(1)
    expect(draft.created_at).toBeTruthy()
    expect(draft.updated_at).toBeTruthy()
    expect(draft.title).toBe('Add request queue foundation')
  })

  it('rejects missing title', () => {
    const validation = validateRequest(makeInput({ title: '   ' }))

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Title is required.')
  })

  it('rejects missing validation plan', () => {
    const validation = validateRequest(makeInput({ validation_plan: '' }))

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Validation plan is required.')
  })

  it('cannot execute directly', () => {
    const validation = validateRequest({
      ...makeInput(),
      status: 'EXECUTED',
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Direct execution is not supported in request drafting v1.')
  })

  it('approval does not execute', () => {
    const approved = approveRequest(markReviewReady(createDraftRequest(makeInput())))

    expect(approved.status).toBe('APPROVED')
    expect(approved.status).not.toBe('EXECUTED')
  })

  it('risk level is bounded 0-3', () => {
    const validation = validateRequest({
      ...makeInput(),
      risk_level: 4 as 0,
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Risk level must be 0, 1, 2, or 3.')
  })

  it('status transitions are valid', () => {
    const draft = createDraftRequest(makeInput())
    const reviewReady = markReviewReady(draft)
    const approved = approveRequest(reviewReady)
    const rejected = rejectRequest(reviewReady, 'Needs tighter validation plan.')

    expect(reviewReady.status).toBe('REVIEW_READY')
    expect(approved.status).toBe('APPROVED')
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.notes).toContain('Rejected: Needs tighter validation plan.')
  })

  it('blocks invalid approval transitions', () => {
    const draft = createDraftRequest(makeInput())

    expect(() => approveRequest(draft)).toThrow('Cannot approve request from status DRAFT.')
  })
})
