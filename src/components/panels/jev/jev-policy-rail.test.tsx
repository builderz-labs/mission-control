import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { JevPolicyRail } from './jev-policy-rail'

const props: ComponentProps<typeof JevPolicyRail> = {
  projects: [
    { id: 1, name: 'Alpha', slug: 'alpha', ticket_prefix: 'AL', status: 'active' },
    { id: 2, name: 'Zeta', slug: 'zeta', ticket_prefix: 'ZE', status: 'active' },
  ], activeProjectId: 2, selectedPolicyId: 7, selectedSessionId: null,
  visibleQuestionIds: new Set(['ready']), evaluations: [], view: 'assistant', canManage: true,
  policies: [{ id: 7, workspace_id: 1, project_id: 2, name: 'Review gate', description: null,
    model: 'jev-latest', mode: 'shadow', enabled: true, created_by: 'operator', created_at: 1, updated_at: 1,
    questions: { ready: { type: 'noul', instructions: 'Is the release ready?' } },
  }], sessions: [{ id: 'session', workspace_id: 1, project_id: 1, created_by_user_id: 1,
    created_by_principal: null, title: 'Accessibility review', provider: 'claude-cli', model: 'haiku',
    status: 'draft', primary_policy_id: null, created_at: 1, updated_at: 1, archived_at: null,
  }], onProject: vi.fn(), onNewSetup: vi.fn(), onSession: vi.fn(), onPolicy: vi.fn(),
  onView: vi.fn(), onToggleQuestion: vi.fn(), onEditQuestion: vi.fn(), onAddQuestion: vi.fn(),
}

describe('Jev project and chat navigation', () => {
  it('keeps the selected project first and makes selection accessible', () => {
    render(<JevPolicyRail {...props} />)
    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names.indexOf('Zeta')).toBeLessThan(names.indexOf('Alpha'))
    expect(screen.getByRole('button', { name: 'Zeta' })).toHaveAttribute('aria-current', 'true')
  })

  it('finds projects by either name or saved setup title', () => {
    render(<JevPolicyRail {...props} />)
    const search = screen.getByRole('searchbox', { name: 'Search projects and setup chats' })
    fireEvent.change(search, { target: { value: 'accessibility' } })
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zeta' })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: ' ZETA ' } })
    expect(screen.getByRole('button', { name: 'Zeta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'unmatched' } })
    expect(screen.getByRole('status')).toHaveTextContent('No projects or chats match')
  })

  it('keeps result-card controls in policies; the sorter owns its own question rail', () => {
    const { rerender } = render(<JevPolicyRail {...props} />)
    expect(screen.queryByRole('region', { name: 'Result cards' })).not.toBeInTheDocument()
    rerender(<JevPolicyRail {...props} view="evaluate" />)
    expect(screen.queryByRole('region', { name: 'Result cards' })).not.toBeInTheDocument()
    rerender(<JevPolicyRail {...props} view="policies" />)
    expect(screen.getByRole('region', { name: 'Result cards' })).toBeInTheDocument()
  })
})
