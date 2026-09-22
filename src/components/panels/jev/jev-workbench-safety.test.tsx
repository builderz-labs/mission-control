import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JevWorkbench } from './jev-workbench'
import type { JevPolicy } from './jev-ui-types'

const policy: JevPolicy = {
  id: 7, workspace_id: 1, project_id: 2, name: 'Review', description: null,
  model: 'jev-latest', mode: 'shadow', enabled: true, created_by: 'operator', created_at: 1, updated_at: 1,
  questions: { ready: { type: 'noul', instructions: 'Is it ready?' } },
}
const props = { canRun: true, onSelect: vi.fn(), onRun: vi.fn(), onLoadContext: vi.fn() }
describe('Jev execution safety', () => {
  it('defaults back to no retention when switching to an older setup', () => {
    const retained = { ...policy, configuration: {
      scope: 'current' as const, projectIds: [2], trigger: 'manual' as const, enforcement: 'advisory' as const,
      contextMode: 'pasted' as const, failureMode: 'retry_then_review' as const, rollout: 'shadow' as const,
      retainPreview: true, uncertaintyThreshold: 0.65, tests: [], risks: [], observability: [],
    } }
    const legacy = { ...policy, id: 8 }
    const view = render(<JevWorkbench {...props} policies={[retained, legacy]} selectedId={7} />)
    expect(screen.getByText('up to 500 redacted characters')).toBeInTheDocument()
    view.rerender(<JevWorkbench {...props} policies={[retained, legacy]} selectedId={8} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
  it('does not allow a pending result to be confused with edited evidence', () => {
    render(<JevWorkbench {...props} onRun={() => new Promise(() => {})} policies={[policy]} selectedId={7} />)
    fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value: 'Reviewed evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate with Jev' }))
    expect(screen.getByLabelText('Context Jev will evaluate')).toBeDisabled()
    expect(screen.getByLabelText('Context format')).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })
  it('explains how to resume when every setup is paused', () => {
    render(<JevWorkbench {...props} policies={[{ ...policy, enabled: false }]} selectedId={7} />)
    expect(screen.getByRole('status')).toHaveTextContent('Open Policies and enable')
    expect(screen.queryByRole('button', { name: 'Evaluate with Jev' })).not.toBeInTheDocument()
  })
})
