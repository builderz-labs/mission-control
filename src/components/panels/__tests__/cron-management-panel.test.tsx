import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CronManagementPanel } from '../cron-management-panel'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Store mock -----------------------------------------------------------------
const cronJobsDefault: any[] = []
let cronJobsState: any[] = cronJobsDefault
let storeOverrides: Record<string, unknown> = {}

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    cronJobs: cronJobsState,
    setCronJobs: (jobs: any[]) => {
      cronJobsState = jobs
    },
    dashboardMode: 'full' as const,
    ...storeOverrides,
  }),
}))

// Logger mock ----------------------------------------------------------------
vi.mock('@/lib/client-logger', () => ({
  createClientLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Cron occurrences mock (returns empty by default so calendar renders) --------
vi.mock('@/lib/cron-occurrences', () => ({
  buildDayKey: (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  getCronOccurrences: () => [],
}))

// Global fetch ---------------------------------------------------------------
const mockFetch = vi.fn()
global.fetch = mockFetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeCronJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  name: 'daily-backup',
  schedule: '0 0 * * *',
  command: 'cd /backup && ./run.sh',
  agentId: 'agent-1',
  enabled: true,
  lastRun: Date.now() - 3600_000,
  nextRun: Date.now() + 3600_000,
  lastStatus: 'success',
  ...overrides,
})

function mockDefaultFetch(jobs: any[] = []) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/cron')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs }),
      })
    }
    if (url.includes('/api/status')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CronManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cronJobsState = []
    storeOverrides = {}
  })

  // 1. Loading state
  it('renders loading state while fetching jobs', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    render(<CronManagementPanel />)
    expect(screen.getByText('Loading jobs...')).toBeInTheDocument()
  })

  // 2. Renders job list after load
  it('renders job list after data loads', async () => {
    const jobs = [makeCronJob()]
    mockDefaultFetch(jobs)
    // Pre-populate the store since setCronJobs is called during load
    cronJobsState = jobs
    render(<CronManagementPanel />)

    await waitFor(() => {
      expect(screen.getByText('daily-backup')).toBeInTheDocument()
    })
    expect(screen.getByText('0 0 * * *')).toBeInTheDocument()
  })

  // 3. Empty state
  it('renders empty state when no jobs exist', async () => {
    mockDefaultFetch([])
    cronJobsState = []
    render(<CronManagementPanel />)

    await waitFor(() => {
      expect(screen.getByText('No cron jobs found')).toBeInTheDocument()
    })
  })

  // 4. Add Job modal opens
  it('opens create modal when Add Job button is clicked', async () => {
    mockDefaultFetch()
    cronJobsState = []
    render(<CronManagementPanel />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Add Job/i }))

    await waitFor(() => {
      expect(screen.getByText('Add New Cron Job')).toBeInTheDocument()
    })

    // Verify form fields are present
    expect(screen.getByPlaceholderText(/daily-backup/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/cd \/path/i)).toBeInTheDocument()
  })

  // 5. Calendar view toggle
  it('switches calendar view modes', async () => {
    mockDefaultFetch()
    cronJobsState = []
    render(<CronManagementPanel />)

    await waitFor(() => {
      expect(screen.getByText('Calendar View')).toBeInTheDocument()
    })

    const user = userEvent.setup()

    // Default is 'week' view. Click 'Day' button.
    await user.click(screen.getByRole('button', { name: 'Day' }))
    // Day view shows "No scheduled jobs for this day." when empty
    await waitFor(() => {
      expect(screen.getByText(/No scheduled jobs for this day/i)).toBeInTheDocument()
    })

    // Switch to Month view
    await user.click(screen.getByRole('button', { name: 'Month' }))
    // Month view should render (presence of grid cells)
    await waitFor(() => {
      expect(screen.getByText(/No jobs scheduled on this date/i)).toBeInTheDocument()
    })
  })

  // 6. Job details display when selecting a job
  it('shows job details panel when a job is selected', async () => {
    const jobs = [makeCronJob()]
    mockDefaultFetch(jobs)
    cronJobsState = jobs

    // Also mock log fetch that happens on job select
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('action=logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ logs: [] }),
        })
      }
      if (url.includes('/api/cron')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobs }),
        })
      }
      if (url.includes('/api/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<CronManagementPanel />)

    await waitFor(() => {
      expect(screen.getByText('daily-backup')).toBeInTheDocument()
    })

    // Before selecting: should show placeholder
    expect(screen.getByText('Select a job to view details and logs')).toBeInTheDocument()

    const user = userEvent.setup()
    // The job name is inside a span with font-medium, inside a clickable div card
    // Find the Scheduled Jobs section first, then click the card
    const scheduledJobsHeading = screen.getByText('Scheduled Jobs')
    const scheduledJobsSection = scheduledJobsHeading.closest('.bg-card') as HTMLElement
    const jobNameInSection = within(scheduledJobsSection).getByText('daily-backup')
    // The closest clickable parent is the card div with onClick={handleJobSelect}
    const clickTarget = jobNameInSection.closest('div[class*="border-border rounded-lg p-4"]') as HTMLElement
    await user.click(clickTarget)

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument()
    })

    // Should show schedule info
    expect(screen.getByText('Recent Logs')).toBeInTheDocument()
  })

  // 7. Search/filter controls work
  it('renders filter controls and search input', async () => {
    mockDefaultFetch()
    cronJobsState = []
    render(<CronManagementPanel />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search jobs, agents, models...')).toBeInTheDocument()
    })

    // Agent filter
    expect(screen.getByDisplayValue('All Agents')).toBeInTheDocument()
    // State filter
    expect(screen.getByDisplayValue('All States')).toBeInTheDocument()
  })

  // 8. Error handling - fetch fails gracefully
  it('handles fetch errors gracefully', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network failure')))
    cronJobsState = []
    render(<CronManagementPanel />)

    // Should not crash and should not be loading forever
    await waitFor(() => {
      // After error the loading state should clear and show empty state
      expect(screen.getByText('No cron jobs found')).toBeInTheDocument()
    })
  })
})
