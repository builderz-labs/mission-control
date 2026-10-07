import { describe, expect, it } from 'vitest'
import { validateWorkSelection } from './context-integrity'
import type { FactoryWorkContext } from './types'

const revision = 'content-os-revision-2'
const workContext: FactoryWorkContext = {
  source_revision: revision,
  ordered_work_queue: [
    {
      action_id: 'review:EP002', target_id: 'EP002', expected_native_state: 'REVIEW',
      action_kind: 'human_gate', blocking: true, label: 'Review EP002: Test',
    },
    {
      action_id: 'publish:EP001', target_id: 'EP001', expected_native_state: 'RENDERED',
      action_kind: 'external_side_effect', blocking: true, label: 'Publish and verify EP001',
    },
  ],
  primary_work_item: {
    action_id: 'review:EP002', target_id: 'EP002', expected_native_state: 'REVIEW',
    action_kind: 'human_gate', blocking: true, label: 'Review EP002: Test',
  },
}

const snapshot = (context: FactoryWorkContext | null = workContext) => ({
  source: { revision },
  work_context: context,
})

describe('factory work-context integrity', () => {
  it('rejects implicit continuation to EP001 when EP002 is the authoritative primary target', () => {
    const result = validateWorkSelection(snapshot(), {
      mode: 'implicit_continuation', target_id: 'EP001', source_revision: revision,
    })
    expect(result).toMatchObject({
      ok: false,
      code: 'STALE_CONTEXT',
      authoritative_primary_target: { target_id: 'EP002', expected_native_state: 'REVIEW' },
    })
  })

  it('accepts implicit continuation to the EP002 REVIEW primary target', () => {
    expect(validateWorkSelection(snapshot(), {
      mode: 'implicit_continuation', target_id: 'EP002', source_revision: revision,
    })).toMatchObject({ ok: true, selected_work_item: { target_id: 'EP002', expected_native_state: 'REVIEW' } })
  })

  it('allows explicit publication of EP001 while it remains in the ordered queue', () => {
    expect(validateWorkSelection(snapshot(), {
      mode: 'explicit_target', target_id: 'EP001', source_revision: revision,
    })).toMatchObject({ ok: true, selected_work_item: { action_id: 'publish:EP001' } })
  })

  it('fails stale or mismatched source revisions closed with the authoritative primary target', () => {
    const staleSnapshot = { source: { revision: 'new-revision' }, work_context: workContext }
    const stale = validateWorkSelection(staleSnapshot, {
      mode: 'implicit_continuation', target_id: 'EP002', source_revision: revision,
    })
    const wrongRequestRevision = validateWorkSelection(snapshot(), {
      mode: 'explicit_target', target_id: 'EP001', source_revision: 'old-revision',
    })
    expect(stale).toMatchObject({ ok: false, code: 'STALE_CONTEXT', authoritative_primary_target: { target_id: 'EP002' } })
    expect(wrongRequestRevision).toMatchObject({ ok: false, code: 'STALE_CONTEXT', authoritative_primary_target: { target_id: 'EP002' } })
  })

  it('fails safely without work_context instead of guessing a target', () => {
    expect(validateWorkSelection(snapshot(null), {
      mode: 'implicit_continuation', target_id: 'EP001', source_revision: revision,
    })).toMatchObject({ ok: false, code: 'NO_WORK_CONTEXT', authoritative_primary_target: null })
  })
})
