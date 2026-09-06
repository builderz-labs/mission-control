import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardSession } from '@/lib/dashboard-cli-fleets'
import { ActiveTerminalSessions } from './active-terminal-sessions'

vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => <span>{alt}</span>,
}))

function session(input: Partial<DashboardSession> & Pick<DashboardSession, 'id'>): DashboardSession {
  return {
    kind: 'codex-cli',
    model: 'codex',
    title: `Session ${input.id}`,
    age: '1m',
    active: true,
    ...input,
  }
}

describe('ActiveTerminalSessions', () => {
  it('shows every active local and remote session and excludes idle history', () => {
    const openSession = vi.fn()
    const sessions = [
      session({ id: 'local-1', title: 'Local Codex', source: 'local' }),
      session({ id: 'remote-1', title: 'Remote Claude', kind: 'gateway', model: 'claude', source: 'gateway' }),
      session({ id: 'idle-1', title: 'Idle Kimi', kind: 'kimi', active: false, source: 'local' }),
    ]

    render(<ActiveTerminalSessions data={{
      sessions,
      isSessionsLoading: false,
      navigateToPanel: vi.fn(),
      openSession,
    }} />)

    expect(screen.getByText('2 live')).toBeInTheDocument()
    expect(screen.getByText('Local Codex')).toBeInTheDocument()
    expect(screen.getByText('Remote Claude')).toBeInTheDocument()
    expect(screen.queryByText('Idle Kimi')).not.toBeInTheDocument()
    expect(screen.getByText('Local CLI')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Open Remote Claude/ }))
    expect(openSession).toHaveBeenCalledWith(sessions[1])
  })

  it('links to session history and explains the empty state', () => {
    const navigateToPanel = vi.fn()
    render(<ActiveTerminalSessions data={{
      sessions: [],
      isSessionsLoading: false,
      navigateToPanel,
      openSession: vi.fn(),
    }} />)

    expect(screen.getByText('No active terminal sessions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View all sessions' }))
    expect(navigateToPanel).toHaveBeenCalledWith('sessions')
  })
})
