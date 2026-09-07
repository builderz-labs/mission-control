import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import type { TranscriptMessage } from '@/lib/session-transcript-types'

const transcripts = vi.hoisted(() => ({
  current: [] as TranscriptMessage[],
  subjects: [] as unknown[],
  options: [] as unknown[],
}))

vi.mock('@/components/chat/use-session-transcript', () => ({
  useSessionTranscript: (subject: unknown, options?: unknown) => {
    transcripts.subjects.push(subject)
    transcripts.options.push(options)
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

function sessionIds(): string[] {
  return transcripts.subjects.map((subject) => (subject as { sessionId: string }).sessionId)
}

beforeEach(() => {
  transcripts.current = []
  transcripts.subjects = []
  transcripts.options = []
})

describe('SessionTerminalWidget', () => {
  it('prompts the operator to start a session when there are none', () => {
    render(<SessionTerminalWidget data={data([])} />)
    expect(screen.getByText('No CLI sessions')).toBeInTheDocument()
  })

  it('renders one terminal per active session rather than a single tabbed one', () => {
    render(<SessionTerminalWidget data={data([
      session('live-a', { active: true }),
      session('live-b', { active: true }),
    ])} />)
    expect(screen.getAllByRole('log')).toHaveLength(2)
    expect(sessionIds()).toEqual(expect.arrayContaining(['live-a', 'live-b']))
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('shows only what is running when anything is live', () => {
    render(<SessionTerminalWidget data={data([
      session('idle', { lastActivity: 100 }),
      session('live', { active: true, lastActivity: 1 }),
    ])} />)
    expect(sessionIds()).toEqual(['live'])
    expect(screen.getByText(/1 live/)).toBeInTheDocument()
  })

  it('falls back to recent sessions so the wall is never a dead rectangle', () => {
    render(<SessionTerminalWidget data={data([session('one'), session('two')])} />)
    expect(sessionIds()).toEqual(expect.arrayContaining(['one', 'two']))
    expect(screen.getByText(/Nothing is running right now/)).toBeInTheDocument()
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

  it('shows an idle cursor for a closed session and a running one while work is in flight', () => {
    const { rerender } = render(<SessionTerminalWidget data={data([session('done')])} />)
    expect(screen.getByText('❯ (session idle)')).toBeInTheDocument()

    transcripts.current = [
      { role: 'assistant', parts: [{ type: 'tool_use', id: 't1', name: 'Bash', input: '{}' }] },
    ]
    rerender(<SessionTerminalWidget data={data([session('done', { active: true })])} />)
    expect(screen.getByText('❯ running…')).toBeInTheDocument()
  })

  it('snaps the wall to a chosen column count', () => {
    render(<SessionTerminalWidget data={data([
      session('a', { active: true }),
      session('b', { active: true }),
    ])} />)
    const grid = screen.getAllByRole('log')[0].closest('.grid') as HTMLElement
    expect(grid.className).toContain('md:grid-cols-2')

    fireEvent.click(screen.getByRole('radio', { name: '1' }))
    expect((screen.getAllByRole('log')[0].closest('.grid') as HTMLElement).className).toContain('grid-cols-1')
  })

  // Both of these were real regressions: without them a pane grew to the height
  // of its transcript and to the width of its longest line, so the page scrolled
  // instead of the terminal and "Jump to latest" landed off screen.
  it('keeps every terminal inside a bounded box so its own scrollback scrolls', () => {
    render(<SessionTerminalWidget data={data([session('live', { active: true })])} />)
    const surface = screen.getByRole('log').parentElement as HTMLElement
    expect(surface.className).toContain('min-w-0')

    const cell = surface.parentElement as HTMLElement
    expect(cell.className).toContain('min-w-0')
    expect(cell.parentElement?.className).toMatch(/h-\[\d+rem\]/)
  })

  it('backs the grid poll cadence off from the single-pane rate', () => {
    render(<SessionTerminalWidget data={data([session('live', { active: true })])} />)
    expect(transcripts.options[0]).toMatchObject({ activeMs: 4000, idleMs: 20000 })
  })

  it('opens the full session view from a cell', () => {
    const payload = data([session('one')])
    render(<SessionTerminalWidget data={payload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(payload.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }))
  })
})
