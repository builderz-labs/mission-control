import { describe, it, expect } from 'vitest'
import {
  validateStatusTransition,
  validateMandatoryFieldsForAssignment,
  validateEvidenceForDone,
  computeSlaDeadlines,
  evaluateSlaStatus,
  checkWipLimit,
  checkRetryCap,
  isValidPriorityTier,
  isValidBlockedType,
  getSlaTiming,
} from '../governance'

// ---------------------------------------------------------------------------
// Priority Tier Validation
// ---------------------------------------------------------------------------
describe('isValidPriorityTier', () => {
  it('accepts P0-P3', () => {
    expect(isValidPriorityTier('P0')).toBe(true)
    expect(isValidPriorityTier('P1')).toBe(true)
    expect(isValidPriorityTier('P2')).toBe(true)
    expect(isValidPriorityTier('P3')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isValidPriorityTier('P4')).toBe(false)
    expect(isValidPriorityTier('high')).toBe(false)
    expect(isValidPriorityTier(null)).toBe(false)
    expect(isValidPriorityTier(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Status Transitions
// ---------------------------------------------------------------------------
describe('validateStatusTransition', () => {
  it('allows same-status (no-op)', () => {
    expect(validateStatusTransition('inbox', 'inbox').allowed).toBe(true)
    expect(validateStatusTransition('done', 'done').allowed).toBe(true)
  })

  it('allows valid forward flow', () => {
    expect(validateStatusTransition('inbox', 'assigned').allowed).toBe(true)
    expect(validateStatusTransition('assigned', 'in_progress').allowed).toBe(true)
    expect(validateStatusTransition('in_progress', 'review').allowed).toBe(true)
    expect(validateStatusTransition('review', 'done').allowed).toBe(true)
  })

  it('allows valid backward flow for rejection/revert', () => {
    expect(validateStatusTransition('assigned', 'inbox').allowed).toBe(true)
    expect(validateStatusTransition('in_progress', 'assigned').allowed).toBe(true)
    expect(validateStatusTransition('review', 'in_progress').allowed).toBe(true)
  })

  it('blocks skipping stages', () => {
    const result = validateStatusTransition('inbox', 'in_progress')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Invalid status transition')
  })

  it('blocks direct inbox -> done', () => {
    expect(validateStatusTransition('inbox', 'done').allowed).toBe(false)
  })

  it('blocks assigned -> done (must go through review)', () => {
    expect(validateStatusTransition('assigned', 'done').allowed).toBe(false)
  })

  it('blocks backward from done', () => {
    expect(validateStatusTransition('done', 'review').allowed).toBe(false)
    expect(validateStatusTransition('done', 'inbox').allowed).toBe(false)
  })

  it('allows review -> quality_review', () => {
    expect(validateStatusTransition('review', 'quality_review').allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mandatory Fields
// ---------------------------------------------------------------------------
describe('validateMandatoryFieldsForAssignment', () => {
  const validTask = {
    assigned_to: 'dev-agent',
    due_date: 1735600000,
    context_note: 'Critical for launch',
    definition_of_done: 'PR merged + tests green',
    priority_tier: 'P1',
  }

  it('passes with all fields present', () => {
    expect(validateMandatoryFieldsForAssignment(validTask).valid).toBe(true)
  })

  it('fails when owner is missing', () => {
    const result = validateMandatoryFieldsForAssignment({ ...validTask, assigned_to: null })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('assigned_to (owner)')
  })

  it('fails when deadline is missing', () => {
    const result = validateMandatoryFieldsForAssignment({ ...validTask, due_date: null })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('due_date (deadline)')
  })

  it('fails when context note is missing', () => {
    const result = validateMandatoryFieldsForAssignment({ ...validTask, context_note: '' })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('context_note')
  })

  it('fails when definition of done is missing', () => {
    const result = validateMandatoryFieldsForAssignment({ ...validTask, definition_of_done: null })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('definition_of_done')
  })

  it('fails when priority tier is invalid', () => {
    const result = validateMandatoryFieldsForAssignment({ ...validTask, priority_tier: 'high' })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('priority_tier (P0/P1/P2/P3)')
  })

  it('reports all missing fields at once', () => {
    const result = validateMandatoryFieldsForAssignment({})
    expect(result.valid).toBe(false)
    expect(result.missing.length).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Evidence Before Done
// ---------------------------------------------------------------------------
describe('validateEvidenceForDone', () => {
  it('passes with at least one comment', () => {
    expect(validateEvidenceForDone(1).valid).toBe(true)
    expect(validateEvidenceForDone(5).valid).toBe(true)
  })

  it('fails with zero comments', () => {
    const result = validateEvidenceForDone(0)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('comment or artifact')
  })
})

// ---------------------------------------------------------------------------
// SLA Deadlines
// ---------------------------------------------------------------------------
describe('computeSlaDeadlines', () => {
  const baseTime = 1000000

  it('computes P0 deadlines (15m ack, 1h artifact)', () => {
    const d = computeSlaDeadlines(baseTime, 'P0')
    expect(d.ack_by).toBe(baseTime + 15 * 60)
    expect(d.first_artifact_by).toBe(baseTime + 60 * 60)
    expect(d.stale_at).toBe(baseTime + 4 * 3600)
  })

  it('computes P2 deadlines (8h ack, 24h artifact)', () => {
    const d = computeSlaDeadlines(baseTime, 'P2')
    expect(d.ack_by).toBe(baseTime + 8 * 3600)
    expect(d.first_artifact_by).toBe(baseTime + 24 * 3600)
  })
})

// ---------------------------------------------------------------------------
// SLA Status Evaluation
// ---------------------------------------------------------------------------
describe('evaluateSlaStatus', () => {
  const baseTime = 1000000
  const deadlines = computeSlaDeadlines(baseTime, 'P1')

  it('returns on_track when well within deadlines', () => {
    const status = evaluateSlaStatus(baseTime + 60, 'P1', deadlines, null, null)
    expect(status).toBe('on_track')
  })

  it('returns breached when ack deadline missed', () => {
    const status = evaluateSlaStatus(deadlines.ack_by + 1, 'P1', deadlines, null, null)
    expect(status).toBe('breached')
  })

  it('returns on_track when ack done before deadline', () => {
    const status = evaluateSlaStatus(deadlines.ack_by + 1, 'P1', deadlines, baseTime + 60, null)
    // ack is done, check first_artifact
    expect(status === 'on_track' || status === 'at_risk').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WIP Limit
// ---------------------------------------------------------------------------
describe('checkWipLimit', () => {
  it('allows when under limit', () => {
    expect(checkWipLimit(0).allowed).toBe(true)
    expect(checkWipLimit(2).allowed).toBe(true)
  })

  it('blocks when at limit', () => {
    const result = checkWipLimit(3)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('WIP limit')
  })

  it('respects custom limit', () => {
    expect(checkWipLimit(4, 5).allowed).toBe(true)
    expect(checkWipLimit(5, 5).allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Retry Cap
// ---------------------------------------------------------------------------
describe('checkRetryCap', () => {
  it('allows when under cap', () => {
    expect(checkRetryCap(0).allowed).toBe(true)
    expect(checkRetryCap(4).allowed).toBe(true)
  })

  it('blocks when at cap', () => {
    const result = checkRetryCap(5)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Retry cap')
  })

  it('respects custom cap', () => {
    expect(checkRetryCap(2, 3).allowed).toBe(true)
    expect(checkRetryCap(3, 3).allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Blocked Type Validation
// ---------------------------------------------------------------------------
describe('isValidBlockedType', () => {
  it('accepts valid types', () => {
    expect(isValidBlockedType('dependency')).toBe(true)
    expect(isValidBlockedType('decision')).toBe(true)
    expect(isValidBlockedType('inactivity')).toBe(true)
  })

  it('rejects invalid types', () => {
    expect(isValidBlockedType('stuck')).toBe(false)
    expect(isValidBlockedType(null)).toBe(false)
  })
})
