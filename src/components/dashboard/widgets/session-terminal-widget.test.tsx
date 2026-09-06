import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import type { TranscriptMessage } from '@/lib/session-transcript-types'

const transcripts = vi.hoisted(() => ({
  current: [] as TranscriptMessage[],
  lastSubject: null as unknown,
}))

vi.mock('@/components/chat/use-session-transcript', () => ({
  useSessionTranscript: (subject: unknown) => {
    transcripts.lastSubject = subject
    return { messages: transcripts.current, loading: false, error: null, refresh: () => {} }
  },
}))

vi.mock('@/components/brand/engine-logo', () => ({
  EngineLogoForText: () => null,
  EngineLogoSet: () => null,
}))

import { SessionTerminalWidget } from './session-terminal-widget'

function session(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return { id, kind: 'claude-code', title: id, ...over }
}

function data(sessions: DashboardSession[]) {
  return {
    sessions,
    isSessionsLoading: false,
    openSession: vi.fn(),
    navigateToPanel: vi.fn(),
  }
}

beforeEach(() => {
  transcripts.current = []
  transcripts.lastSubject = null
})

describe('SessionTerminalWidget', () => {
  it('prompts the operator to start a session when there are none', () => {
    render(<SessionTerminalWidget data={data([])} />)
    expect(screen.getByText('No CLI sessions')).toBeInTheDocument()
  })

  it('opens on the live session rather than the first in the list', () => {
    render(<SessionTerminalWidget data={data([
      session('idle', { lastActivity: 100 }),
      session('live', { active: true, lastActivity: 1 }),
    ])} />)
    expect(screen.getByRole('tab', { name: /live/ })).toHaveAttribute('aria-selected', 'true')
    expect(transcripts.lastSubject).toMatchObject({ sessionId: 'live' })
  })

  it('renders the transcript as terminal lines', () => {
    transcripts.current = [
      { role: 'user', parts: [{ type: 'text', text: 'run the tests' }] },
      { role: 'assistant', parts: [{ type: 'tool_use', id: 't1', name: 'Bash', input: '{"command":"pnpm test"}' }] },
    ]
    render(<SessionTerminalWidget data={data([session('live', { active: true })])} />)
    expect(screen.getByText('❯ run the tests')).toBeInTheDocument()
    expect(screen.getByText('$ Bash "command":"pnpm test"')).toBeInTheDocument()
  })

  it('switches the terminal when another session tab is selected', () => {
    render(<SessionTerminalWidget data={data([session('one'), session('two')])} />)
    fireEvent.click(screen.getByRole('tab', { name: /two/ }))
    expect(transcripts.lastSubject).toMatchObject({ sessionId: 'two' })
  })

  it('shows an idle cursor for a closed session and a running one while work is in flight', () => {
    const { rerender } = render(<SessionTerminalWidget data={data([session('done')])} />)
    expect(screen.getByText('❯ (session idle)')).toBeInTheDocument()

    transcripts.current = [
      { role: 'assistant', parts: [{ type: 'tool_use', id: 't1', name: 'Bash', input: '{}' }] },
    ]
    rerender(<SessionTerminalWidget data={data([session('done', { active: true })])} />)
    expect(screen.getByText('❯ running…')).toBeInTheDocument()
  })

  // Both of these were real regressions: without them the pane grew to the
  // height of the transcript and to the width of its longest line, so the page
  // scrolled instead of the terminal and the "Jump to latest" button landed
  // hundreds of pixels off screen.
  it('keeps the terminal inside a bounded box so its own scrollback scrolls', () => {
    render(<SessionTerminalWidget data={data([session('live', { active: true })])} />)
    const surface = screen.getByRole('log').parentElement as HTMLElement
    expect(surface.className).toContain('min-w-0')

    const column = surface.parentElement as HTMLElement
    expect(column.className).toContain('min-w-0')
    expect(column.parentElement?.className).toMatch(/h-\[\d+rem\]/)
  })

  it('opens the full session view from the title bar', () => {
    const payload = data([session('one')])
    render(<SessionTerminalWidget data={payload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(payload.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }))
  })
})
