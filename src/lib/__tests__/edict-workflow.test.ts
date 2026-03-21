import { describe, expect, it } from 'vitest'
import {
  getProjectWorkflowSemantics,
  normalizeProjectWorkflowMode,
  validateEdictTaskTransition,
} from '@/lib/edict-workflow'

describe('edict workflow', () => {
  it('normalizes edict workflow mode aliases', () => {
    expect(normalizeProjectWorkflowMode('edict')).toBe('edict_v1')
    expect(normalizeProjectWorkflowMode('edict_v1')).toBe('edict_v1')
    expect(normalizeProjectWorkflowMode('standard')).toBe('standard')
  })

  it('maps edict task status to stage and role semantics', () => {
    expect(getProjectWorkflowSemantics({ workflow_mode: 'edict_v1' }, 'review')).toMatchObject({
      workflowMode: 'edict_v1',
      workflowLabel: 'Edict v1',
      stage: 'dispatch',
      role: 'dispatcher',
      badgeLabel: 'Dispatch',
    })
  })

  it('blocks skipping forward edict gates', () => {
    expect(validateEdictTaskTransition({ currentStatus: 'assigned', nextStatus: 'in_progress' })).toEqual({
      ok: false,
      error: 'Edict workflow cannot skip gates. Move task to deliberation before execution.',
    })
  })
})
