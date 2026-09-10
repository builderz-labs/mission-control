import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildCliFleets, type DashboardSession } from '@/lib/dashboard-cli-fleets'
import { SessionWorkbenchWidget } from './session-workbench-widget'
import type { DashboardData } from '../widget-primitives'

vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => <span>{alt}</span>,
}))

function session(kind: string, id: string, title: string, active = false): DashboardSession {
  return { id, kind, key: id, title, active, model: kind, tokens: '0/0', age: '1m' }
}

function data(sessions: DashboardSession[]): DashboardData {
  return {
    isLocal: true,
    systemStats: null,
    dbStats: null,
    claudeStats: null,
    githubStats: null,
    loading: { system: false, sessions: false, claude: false, github: false },
    sessions,
    logs: [],
    agents: [],
    tasks: [],
    connection: { isConnected: false, url: '', reconnectAttempts: 0 },
    subscription: null,
    navigateToPanel: () => undefined,
    openSession: () => undefined,
    memPct: null,
    diskPct: Number.NaN,
    systemLoad: 0,
    activeSessions: sessions.filter((row) => row.active).length,
    errorCount: 0,
    onlineAgents: 0,
    cliFleets: buildCliFleets(sessions),
    runningTasks: 0,
    inboxCount: 0,
    assignedCount: 0,
    reviewCount: 0,
    doneCount: 0,
    backlogCount: 0,
    mergedRecentLogs: [],
    recentErrorLogs: 0,
    localOsStatus: { value: 'Healthy', status: 'good' },
    mcHealth: { value: 'Healthy', status: 'good' },
    gatewayHealthStatus: 'bad',
    isSystemLoading: false,
    isSessionsLoading: false,
    isClaudeLoading: false,
    isGithubLoading: false,
    hermesCronJobCount: 0,
    subscriptionLabel: null,
    subscriptionPrice: null,
  }
}

describe('SessionWorkbenchWidget', () => {
  it('renders sessions from every CLI engine on the first page', () => {
    const sessions = [
      session('claude-code', 'c1', 'Claude task', true),
      session('codex-cli', 'x1', 'Codex task'),
      session('grok', 'g1', 'Grok task', true),
      session('kimi', 'k1', 'Kimi task'),
      session('hermes', 'h1', 'Hermes task'),
      session('opencode', 'o1', 'OpenCode task'),
      ...Array.from({ length: 8 }, (_, index) => session('codex-cli', `extra-${index}`, `Extra ${index}`)),
    ]
    render(<SessionWorkbenchWidget data={data(sessions)} />)
    expect(screen.getByText('CLI Sessions')).toBeInTheDocument()
    expect(screen.getByText('Grok task')).toBeInTheDocument()
    expect(screen.getByText('Kimi task')).toBeInTheDocument()
    expect(screen.getByText('Hermes task')).toBeInTheDocument()
    expect(screen.getByText('OpenCode task')).toBeInTheDocument()
    expect(screen.getByText('Extra 7')).toBeInTheDocument()
    expect(screen.getByText('14/14')).toBeInTheDocument()
  })

  it('caps the initial DOM and progressively reveals more sessions', () => {
    const sessions = Array.from({ length: 45 }, (_, index) => (
      session('codex-cli', `codex-${index}`, `Codex ${index}`)
    ))
    render(<SessionWorkbenchWidget data={data(sessions)} />)

    expect(screen.getByText('Codex 39')).toBeInTheDocument()
    expect(screen.queryByText('Codex 40')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }))
    expect(screen.getByText('Codex 44')).toBeInTheDocument()
  })

  it('filters to a single CLI engine', () => {
    const sessions = [
      session('claude-code', 'c1', 'Claude task', true),
      session('grok', 'g1', 'Grok task', true),
      session('kimi', 'k1', 'Kimi task'),
    ]
    render(<SessionWorkbenchWidget data={data(sessions)} />)
    fireEvent.click(screen.getByRole('button', { name: /Grok 1/ }))
    expect(screen.getByText('Grok task')).toBeInTheDocument()
    expect(screen.queryByText('Claude task')).not.toBeInTheDocument()
    expect(screen.queryByText('Kimi task')).not.toBeInTheDocument()
  })

  it('opens a session from the list', () => {
    const onOpen = vi.fn()
    const sessions = [session('kimi', 'k1', 'Kimi task')]
    const payload = data(sessions)
    payload.openSession = onOpen
    render(<SessionWorkbenchWidget data={payload} />)
    fireEvent.click(screen.getByRole('button', { name: /Kimi task/ }))
    expect(onOpen).toHaveBeenCalledWith(sessions[0])
  })
})
