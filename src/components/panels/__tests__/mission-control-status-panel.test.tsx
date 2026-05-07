import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MissionControlStatusPanel } from '../mission-control-status-panel'

const mockTriggerRefresh = vi.fn()

vi.mock('@/lib/use-smart-poll', () => ({
  useSmartPoll: vi.fn(() => mockTriggerRefresh),
}))

vi.mock('@/components/ui/loader', () => ({
  Loader: ({ label }: { label?: string }) => <div>{label ?? 'Loading'}</div>,
}))

const mockData = {
  agent: 'Workflow Governor v1',
  label: 'OBSERVE ONLY',
  status: 'PASS',
  risk_level: 0,
  timestamp: '2026-05-07T14:19:29.790Z',
  repo: 'niko4244/mission-control',
  repo_state: {
    branch_current: 'main',
    is_main: true,
    working_tree_clean: true,
    ahead_of_upstream: 0,
    behind_upstream: 0,
  },
  pr_state: { number: null, state: null, mergeable: null, changed_files: null },
  validation_state: { preflight_passed: true, all_validations_passed: true },
  bot_results: {
    'mission-control-preflight': { agent: 'Mission Control Preflight', status: 'PASS', risk_level: 0 },
  },
  approval_gates: [],
  next_action: 'idle',
  next_action_description: 'No action required — system is in a stable, clean state',
  confidence: 0.99,
  commands: ['node scripts/workflow-governor.cjs --repo niko4244/mission-control'],
  stop_conditions: [],
  notes: [],
  metadata: { execution_time_ms: 5000 },
}

describe('MissionControlStatusPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockTriggerRefresh.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders PASS / idle state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    render(<MissionControlStatusPanel />)

    const passBadges = await screen.findAllByText('PASS')
    expect(passBadges.length).toBeGreaterThan(0)
    expect(screen.getByText('idle')).toBeInTheDocument()
    expect(screen.getByText('OBSERVE ONLY')).toBeInTheDocument()
    expect(screen.getByText('Confidence 99%')).toBeInTheDocument()
  })

  it('renders branch and working tree state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText('main')).toBeInTheDocument()
    expect(screen.getByText('clean')).toBeInTheDocument()
  })

  it('renders dirty working tree', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockData,
        repo_state: { ...mockData.repo_state, working_tree_clean: false },
      }),
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText('dirty')).toBeInTheDocument()
  })

  it('renders approval gates as read-only with authority', async () => {
    const dataWithGates = {
      ...mockData,
      approval_gates: [{
        gate_id: 'merge_pr_gate',
        action: 'merge_pr',
        status: 'READY',
        reason: 'Merging is irreversible — verify all checks pass',
        approval_required: true,
        approval_granted: false,
        authority: 'Owner (nik.marconcini@gmail.com)',
      }],
    }
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => dataWithGates,
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText(/approval required — not executable here/i)).toBeInTheDocument()
    expect(screen.getByText('merge_pr')).toBeInTheDocument()
    expect(screen.getByText(/Owner \(nik\.marconcini@gmail\.com\)/)).toBeInTheDocument()
    expect(screen.getByText(/Awaiting approval/i)).toBeInTheDocument()
  })

  it('renders stop conditions', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockData,
        status: 'FAIL',
        stop_conditions: ['Working tree is dirty on main — commit or stash before continuing'],
      }),
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText(/Working tree is dirty on main/i)).toBeInTheDocument()
  })

  it('renders all commands as display-only text', async () => {
    const multiCommandData = {
      ...mockData,
      commands: [
        'node scripts/workflow-governor.cjs --repo niko4244/mission-control',
        'pnpm typecheck',
      ],
    }
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => multiCommandData,
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText('node scripts/workflow-governor.cjs --repo niko4244/mission-control')).toBeInTheDocument()
    expect(screen.getByText('pnpm typecheck')).toBeInTheDocument()
    expect(screen.getByText(/Copy only — no execution controls exposed/i)).toBeInTheDocument()
  })

  it('renders notes section when notes are present', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockData,
        notes: ['92 commits ahead of upstream — consider syncing with remote', 'Preflight checks all passed'],
      }),
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText(/92 commits ahead of upstream/i)).toBeInTheDocument()
    expect(screen.getByText(/Preflight checks all passed/i)).toBeInTheDocument()
  })

  it('does not render Notes section when notes is empty', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    render(<MissionControlStatusPanel />)

    await screen.findByText('OBSERVE ONLY')
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('renders a Refresh button that calls the polling trigger', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    render(<MissionControlStatusPanel />)

    const refreshBtn = await screen.findByRole('button', { name: /refresh/i })
    expect(refreshBtn).toBeInTheDocument()

    fireEvent.click(refreshBtn)
    expect(mockTriggerRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders API error state without crashing', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

    render(<MissionControlStatusPanel />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Network error/i)).toBeInTheDocument()
  })

  it('renders HTTP error state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    render(<MissionControlStatusPanel />)

    expect(await screen.findByText(/HTTP 500/i)).toBeInTheDocument()
  })

  it('does not expose execute, commit, push, or merge buttons', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockData,
        approval_gates: [{
          gate_id: 'merge_pr_gate',
          action: 'merge_pr',
          status: 'READY',
          reason: 'Merging is irreversible',
          approval_required: true,
          approval_granted: false,
          authority: 'Owner',
        }],
      }),
    } as Response)

    render(<MissionControlStatusPanel />)

    await screen.findByText('OBSERVE ONLY')

    const buttons = document.querySelectorAll('button')
    buttons.forEach(btn => {
      expect(btn.textContent?.toLowerCase()).not.toMatch(/execute|run|commit|push|merge|approve|apply/)
    })
  })
})
