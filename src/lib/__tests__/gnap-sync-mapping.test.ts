import { describe, expect, it } from 'vitest'
import { gnapStatusToMc, mcPriorityToGnap, mcStatusToGnap } from '../gnap-sync'

describe('GNAP status mapping', () => {
  it('maps MC statuses to GNAP states', () => {
    expect(mcStatusToGnap('backlog')).toBe('backlog')
    expect(mcStatusToGnap('pending')).toBe('backlog')
    expect(mcStatusToGnap('inbox')).toBe('backlog')
    expect(mcStatusToGnap('in_progress')).toBe('in_progress')
    expect(mcStatusToGnap('done')).toBe('done')
    expect(mcStatusToGnap('review')).toBe('review')
    expect(mcStatusToGnap('blocked')).toBe('blocked')
    expect(mcStatusToGnap('cancelled')).toBe('cancelled')
  })

  it('maps GNAP states back to MC statuses', () => {
    expect(gnapStatusToMc('backlog')).toBe('backlog')
    expect(gnapStatusToMc('in_progress')).toBe('in_progress')
    expect(gnapStatusToMc('done')).toBe('done')
    expect(gnapStatusToMc('review')).toBe('review')
  })

  it('falls back for unknown values', () => {
    expect(mcStatusToGnap('unknown_status')).toBe('backlog')
    expect(gnapStatusToMc('unknown_state')).toBe('inbox')
  })
})

describe('GNAP priority mapping', () => {
  it('maps MC priorities to GNAP priorities', () => {
    expect(mcPriorityToGnap('low')).toBe('low')
    expect(mcPriorityToGnap('medium')).toBe('medium')
    expect(mcPriorityToGnap('high')).toBe('high')
    expect(mcPriorityToGnap('critical')).toBe('critical')
    expect(mcPriorityToGnap('urgent')).toBe('critical')
  })

  it('falls back to medium for unknown priorities', () => {
    expect(mcPriorityToGnap('unknown')).toBe('medium')
  })
})
