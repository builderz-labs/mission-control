import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JevSetupAssistant } from './jev-setup-assistant'
import { idsForScope, latestStoredInput } from './jev-setup-state'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }))
const project = { id: 4, name: 'Mission Control', slug: 'mc', ticket_prefix: 'MC', status: 'active' }
const clarification = { id: 'clarify_evidence', title: 'Which evidence should be judged?', help: 'Select the input.', options: [
  { value: 'docs', label: 'Documentation', consequence: 'Review written evidence.', recommended: true },
  { value: 'tests', label: 'Tests', consequence: 'Review test results.' },
] }
const response = {
  draft: { name: 'Review', summary: 'Review evidence', description: 'Review evidence safely',
    questions: { ready: { type: 'noul', instructions: 'Is it ready?' } }, tests: ['Contract'], risks: ['Missing'], observability: ['Latency'], warnings: [], clarifications: [] },
  configuration: { scope: 'current', projectIds: [4], trigger: 'manual', enforcement: 'advisory', contextMode: 'pasted', rollout: 'shadow', retainPreview: false },
  provider: { kind: 'claude-cli', model: 'haiku' }, warnings: [],
}
const props = { projects: [project], activeProjectId: 4, canOperate: true, assistantAvailable: true, sessionId: null,
  onSessionChange: vi.fn(), onSessionsChanged: vi.fn(), onCreate: vi.fn(), onReady: vi.fn() }
beforeEach(() => { mocks.apiFetch.mockReset(); vi.clearAllMocks() })

describe('Jev setup conversation continuity', () => {
  it('restores unanswered clarifications after a parent remount', async () => {
    mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(path.includes('/messages?') ? {
      messages: [{ role: 'user', content: JSON.stringify({ goal: 'Review evidence', answers: {}, projectIds: [4] }) }],
    } : { session: { id: 'session', project_id: 4 }, latestRevision: {
      draft: { ...response.draft, clarifications: [clarification] }, configuration: response.configuration,
      provider: 'openai', model: 'gpt-4.1-mini', revision_no: 1, session_id: 'session',
    } }))
    render(<JevSetupAssistant {...props} sessionId="session" />)
    expect(await screen.findByText(clarification.title)).toBeInTheDocument()
    expect(screen.queryByText('Review before saving the policy')).not.toBeInTheDocument()
  })
  it('sends manually edited questions to the next AI revision', async () => {
    mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(path === '/api/jev/sessions' ? { session: { id: 'session' } } : response))
    render(<JevSetupAssistant {...props} />)
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Review evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    await screen.findByText('Review before saving the policy')
    fireEvent.click(screen.getByRole('button', { name: 'Edit ready' }))
    fireEvent.change(screen.getByLabelText('Question', { exact: true }), { target: { value: 'Does the evidence document a rollback?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Revise with assistant'), { target: { value: 'Add a category' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise draft' }))
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenLastCalledWith('/api/jev/assistant', expect.objectContaining({
      body: expect.stringContaining('Does the evidence document a rollback?'),
    })))
  })
  it('explains a missing optional API key without switching away from Claude Code automatically', () => {
    render(<JevSetupAssistant {...props} assistantOptions={[
      { kind: 'claude-cli', label: 'Claude Code', configured: true, model: 'haiku' },
      { kind: 'openai', label: 'OpenAI API', configured: false, model: 'gpt-4.1-mini' },
    ]} />)
    expect(screen.getByLabelText('Setup assistant')).toHaveValue('claude-cli')
    fireEvent.change(screen.getByLabelText('Setup assistant'), { target: { value: 'openai' } })
    expect(screen.getByRole('button', { name: 'Use recommended setup' })).toBeDisabled()
    expect(screen.getByText(/administrator can add OPENAI_API_KEY/)).toBeInTheDocument()
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })
  it('aborts a pending provider when changing project or leaving the chat', async () => {
    let providerSignal: AbortSignal | undefined
    mocks.apiFetch.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/jev/sessions') return Promise.resolve({ session: { id: 'session' } })
      providerSignal = options.signal ?? undefined
      return new Promise(() => {})
    })
    const view = render(<JevSetupAssistant {...props} />)
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Review evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    await waitFor(() => expect(providerSignal).toBeDefined())
    view.unmount(); expect(providerSignal?.aborted).toBe(true)
  })
  it('keeps repository scope explicit and handles empty history', () => {
    expect(idsForScope('current', [project], 4, [9])).toEqual([4])
    expect(idsForScope('selected', [project], 4, [9])).toEqual([9])
    expect(idsForScope('all', [project, { ...project, id: 5, status: 'archived' }], 4, [])).toEqual([4])
    expect(latestStoredInput([])).toEqual({})
  })
})
