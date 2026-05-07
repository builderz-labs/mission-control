import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GovernorStatusWidget } from '../governor-status-widget'
import type { DashboardData } from '../../widget-primitives'

vi.mock('@/lib/use-smart-poll', () => ({
  useSmartPoll: vi.fn(),
}))

const mockNavigate = vi.fn()

const minimalData = {
  navigateToPanel: mockNavigate,
} as unknown as DashboardData

const mockGov = {
  status: 'PASS',
  risk_level: 0,
  next_action: 'idle',
  confidence: 0.99,
  timestamp: '2026-05-07T20:00:00.000Z',
  repo_state: { branch_current: 'main', working_tree_clean: true },
}

describe('GovernorStatusWidget', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows loading state before data arrives', () => {
    vi.mocked(global.fetch).mockReturnValue(new Promise(() => {}))
    render(<GovernorStatusWidget data={minimalData} />)
    expect(screen.getByText(/loading governor state/i)).toBeInTheDocument()
  })

  it('renders PASS summary fields', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockGov,
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    expect(await screen.findByText('PASS')).toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
    expect(screen.getByText('idle')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('clean')).toBeInTheDocument()
    expect(screen.getByText('99%')).toBeInTheDocument()
  })

  it('renders dirty working tree', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockGov,
        repo_state: { branch_current: 'feature-branch', working_tree_clean: false },
      }),
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    expect(await screen.findByText('dirty')).toBeInTheDocument()
    expect(screen.getByText('feature-branch')).toBeInTheDocument()
  })

  it('renders WARN status with correct label', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockGov, status: 'WARN', risk_level: 1 }),
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    expect(await screen.findByText('WARN')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('renders fetch error state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    expect(await screen.findByText(/HTTP 500/i)).toBeInTheDocument()
  })

  it('renders network error state', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

    render(<GovernorStatusWidget data={minimalData} />)

    expect(await screen.findByText(/Network error/i)).toBeInTheDocument()
  })

  it('Details button navigates to mc-status panel', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockGov,
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    const btn = await screen.findByRole('button', { name: /details/i })
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('mc-status')
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('Details button does not execute commands or mutate state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockGov,
    } as Response)

    render(<GovernorStatusWidget data={minimalData} />)

    await screen.findByText('PASS')

    const buttons = document.querySelectorAll('button')
    buttons.forEach(btn => {
      expect(btn.textContent?.toLowerCase()).not.toMatch(/execute|run|commit|push|merge|approve|apply/)
    })
  })
})
