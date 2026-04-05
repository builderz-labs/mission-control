import { describe, expect, it } from 'vitest'
import { normalizeTaskCreateStatus, normalizeTaskStatusForOutcome, normalizeTaskUpdateStatus } from '../task-status'

describe('task status normalization', () => {
  it('sets assigned status on create when assignee is present', () => {
    expect(normalizeTaskCreateStatus(undefined, 'main')).toBe('assigned')
    expect(normalizeTaskCreateStatus('inbox', 'main')).toBe('assigned')
  })

  it('keeps explicit non-inbox status on create', () => {
    expect(normalizeTaskCreateStatus('in_progress', 'main')).toBe('in_progress')
  })

  it('auto-promotes inbox to assigned when assignment is added via update', () => {
    expect(
      normalizeTaskUpdateStatus({
        currentStatus: 'inbox',
        requestedStatus: undefined,
        assignedTo: 'main',
        assignedToProvided: true,
      })
    ).toBe('assigned')
  })

  it('auto-demotes assigned to inbox when assignment is removed via update', () => {
    expect(
      normalizeTaskUpdateStatus({
        currentStatus: 'assigned',
        requestedStatus: undefined,
        assignedTo: '',
        assignedToProvided: true,
      })
    ).toBe('inbox')
  })

  it('does not override explicit status changes on update', () => {
    expect(
      normalizeTaskUpdateStatus({
        currentStatus: 'inbox',
        requestedStatus: 'in_progress',
        assignedTo: 'main',
        assignedToProvided: true,
      })
    ).toBe('in_progress')
  })

  it('moves awaiting_owner failure outcomes into failed', () => {
    expect(normalizeTaskStatusForOutcome('awaiting_owner', 'failed')).toBe('failed')
    expect(normalizeTaskStatusForOutcome('awaiting_owner', 'partial')).toBe('failed')
    expect(normalizeTaskStatusForOutcome('awaiting_owner', 'abandoned')).toBe('failed')
  })

  it('keeps successful awaiting_owner tasks as awaiting_owner', () => {
    expect(normalizeTaskStatusForOutcome('awaiting_owner', 'success')).toBe('awaiting_owner')
  })
})
