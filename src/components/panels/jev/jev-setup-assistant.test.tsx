import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JevSetupAssistant } from './jev-setup-assistant'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch }))

const response = {
  draft: {
    summary: 'Review release readiness', name: 'Release review', description: 'Assess release evidence',
    questions: { ready: { type: 'noul', instructions: 'Is the release evidence sufficient?' } },
    tests: ['Contract test'], risks: ['Incomplete evidence'], observability: ['Record model'], warnings: [],
  },
  configuration: {
    scope: 'current', projectIds: [4], trigger: 'manual', enforcement: 'advisory',
    contextMode: 'safe_repository', failureMode: 'retry_then_review', rollout: 'shadow',
    retainPreview: false, uncertaintyThreshold: 0.65,
    tests: ['Contract test'], risks: ['Incomplete evidence'], observability: ['Record model'],
  },
  provider: { kind: 'claude-cli', model: 'haiku' }, warnings: [],
} as const

const project = { id: 4, name: 'Mission Control', slug: 'mission-control', ticket_prefix: 'MC', status: 'active' }

describe('Jev setup assistant', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockImplementation((path: string) => {
      if (path === '/api/jev/sessions') return Promise.resolve({ session: { id: '05a3cfd3-b903-40c5-a6ab-2b8871d7df19' } })
      if (path === '/api/jev/assistant') return Promise.resolve(response)
      if (path.startsWith('/api/jev/sessions/')) return Promise.resolve({ session: {} })
      throw new Error(`Unexpected request ${path}`)
    })
  })

  const renderAssistant = (overrides: Partial<ComponentProps<typeof JevSetupAssistant>> = {}) => render(
    <JevSetupAssistant projects={[project]} activeProjectId={4} canOperate assistantAvailable
      sessionId={null} onSessionChange={vi.fn()} onSessionsChanged={vi.fn()}
      onCreate={vi.fn()} onReady={vi.fn()} {...overrides} />,
  )

  it('creates a reviewable policy with the recommended one-click path', async () => {
    const onCreate = vi.fn().mockResolvedValue([{ id: 9, project_id: 4 }])
    renderAssistant({ onCreate })
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess release readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    expect(await screen.findByText('Review before saving the policy')).toBeInTheDocument()
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/jev/assistant', expect.objectContaining({ timeoutMs: 140_000 }))
    const created = mocks.apiFetch.mock.calls.find(([path]) => path === '/api/jev/sessions')?.[1]
    expect(JSON.parse(created.body).initialInput).toMatchObject({
      goal: 'Assess release readiness', projectIds: [4], answers: { scope: 'current' },
    })
    expect((screen.getByLabelText('Editable Jev schema') as HTMLTextAreaElement).value).toContain('ready')
    fireEvent.click(screen.getByRole('button', { name: /Save to 1 repository/ }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Release review', questions: expect.objectContaining({ ready: expect.any(Object) }),
    }), [4]))
  })

  it('asks progressive recommended questions with a custom-answer path', () => {
    renderAssistant()
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess risk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Customize setup' }))
    expect(screen.getByText('Where should this setup apply?')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Custom answer'), { target: { value: 'Future repositories only' } })
    expect(screen.getByRole('button', { name: 'Use custom answer' })).toBeEnabled()
  })

  it('lets the user cancel a slow draft without displaying an error', async () => {
    mocks.apiFetch.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/jev/sessions') return Promise.resolve({ session: { id: 'draft-session' } })
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
      })
    })
    renderAssistant()
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess release readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/jev/assistant', expect.any(Object)))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use recommended setup' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('What do you want Jev to evaluate?')).toHaveValue('Assess release readiness')
  })

  it('supports conversational revision without activating the policy', async () => {
    renderAssistant()
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess release readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    await screen.findByText('Review before saving the policy')
    fireEvent.change(screen.getByLabelText('Revise with assistant'), { target: { value: 'Make this stricter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise draft' }))
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenLastCalledWith('/api/jev/assistant', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('Make this stricter'),
    })))
  })

  it('reuses the durable draft when retrying a failed provider request', async () => {
    let attempts = 0
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/jev/sessions') return Promise.resolve({ session: { id: 'durable-draft' } })
      if (path === '/api/jev/assistant') return ++attempts === 1
        ? Promise.reject(new Error('Assistant unavailable')) : Promise.resolve(response)
      throw new Error(`Unexpected request ${path}`)
    })
    renderAssistant()
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess release readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Assistant unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    await screen.findByText('Review before saving the policy')
    expect(mocks.apiFetch.mock.calls.filter(([path]) => path === '/api/jev/sessions')).toHaveLength(1)
    expect(mocks.apiFetch).toHaveBeenLastCalledWith('/api/jev/assistant', expect.objectContaining({
      body: expect.stringContaining('durable-draft'),
    }))
  })

  it('asks model-generated multiple-choice clarifications before final review', async () => {
    const adaptive = {
      ...response,
      draft: { ...response.draft, clarifications: [{
        id: 'release_target', title: 'Which release should this evaluate?',
        help: 'Choose the evidence boundary.', options: [
          { value: 'candidate', label: 'Current candidate', consequence: 'Use current release evidence.', recommended: true },
          { value: 'next', label: 'Next release', consequence: 'Prepare a reusable future policy.' },
        ],
      }] },
    }
    let assistantCalls = 0
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/jev/sessions') return Promise.resolve({ session: { id: '05a3cfd3-b903-40c5-a6ab-2b8871d7df19' } })
      if (path === '/api/jev/assistant') return Promise.resolve(++assistantCalls === 1 ? adaptive : response)
      throw new Error(`Unexpected request ${path}`)
    })
    renderAssistant()
    fireEvent.change(screen.getByLabelText('What do you want Jev to evaluate?'), { target: { value: 'Assess release readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended setup' }))
    expect(await screen.findByText('Which release should this evaluate?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Current candidate/ }))
    expect(await screen.findByText('Review before saving the policy')).toBeInTheDocument()
    const latest = mocks.apiFetch.mock.calls.filter(([path]) => path === '/api/jev/assistant').at(-1)?.[1]
    expect(String(latest?.body)).toContain('release_target')
  })

  it('restores a durable setup chat and its latest revision after reload', async () => {
    const id = '05a3cfd3-b903-40c5-a6ab-2b8871d7df19'
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === `/api/jev/sessions/${id}`) return Promise.resolve({
        session: { id, project_id: 4, title: 'Assess restored release' },
        latestRevision: {
          id: 1, session_id: id, revision_no: 1, draft: response.draft,
          configuration: response.configuration, model: 'haiku', provider: 'claude-cli',
        },
      })
      if (path.endsWith('/messages?limit=200')) return Promise.resolve({ messages: [{
        role: 'user', content: JSON.stringify({
          goal: 'Assess restored release', answers: { scope: 'current' }, projectIds: [4],
        }),
      }] })
      throw new Error(`Unexpected request ${path}`)
    })
    renderAssistant({ sessionId: id })
    expect(await screen.findByText('Review before saving the policy')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Release review')).toBeInTheDocument()
  })
})
