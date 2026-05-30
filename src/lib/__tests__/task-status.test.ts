import { describe, expect, it } from 'vitest'
import { normalizeTaskCreateStatus, normalizeTaskUpdateStatus, resolveTaskAssignee } from '../task-status'

describe('resolveTaskAssignee — coordinator auto-routing (issue #663)', () => {
  it('uses the explicit assignee when provided, ignoring coordinator', () => {
    expect(resolveTaskAssignee('Aegis', 'coordinator')).toBe('Aegis')
  })

  it('falls back to the coordinator when no assignee is given', () => {
    expect(resolveTaskAssignee(null, 'coordinator')).toBe('coordinator')
    expect(resolveTaskAssignee(undefined, 'coordinator')).toBe('coordinator')
    expect(resolveTaskAssignee('', 'coordinator')).toBe('coordinator')
    expect(resolveTaskAssignee('   ', 'coordinator')).toBe('coordinator')
  })

  it('stays unassigned when neither assignee nor coordinator is set (feature off)', () => {
    expect(resolveTaskAssignee(null, '')).toBeNull()
    expect(resolveTaskAssignee(undefined, undefined)).toBeNull()
    expect(resolveTaskAssignee('', '   ')).toBeNull()
  })

  it('trims whitespace from the resolved assignee', () => {
    expect(resolveTaskAssignee('  Aegis  ', '')).toBe('Aegis')
    expect(resolveTaskAssignee(null, '  coordinator  ')).toBe('coordinator')
  })

  it('a coordinator-routed task is normalized to assigned status', () => {
    const assignee = resolveTaskAssignee(null, 'coordinator')
    expect(normalizeTaskCreateStatus('inbox', assignee)).toBe('assigned')
  })

  it('an unrouted task with no coordinator stays inbox', () => {
    const assignee = resolveTaskAssignee(null, '')
    expect(normalizeTaskCreateStatus('inbox', assignee)).toBe('inbox')
  })
})

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
})

