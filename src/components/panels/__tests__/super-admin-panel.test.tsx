import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuperAdminPanel } from '../super-admin-panel'

// ---------------------------------------------------------------------------
// Zustand store mock
// ---------------------------------------------------------------------------
const storeDefaults = {
  currentUser: { id: 1, username: 'admin', display_name: 'Admin', role: 'admin' as const },
  dashboardMode: 'full' as const,
}

let storeOverrides: Record<string, unknown> = {}

vi.mock('@/store', () => ({
  useMissionControl: () => ({ ...storeDefaults, ...storeOverrides }),
}))

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
global.fetch = mockFetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const now = Math.floor(Date.now() / 1000)

const makeTenant = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  slug: 'acme',
  display_name: 'Acme Corp',
  linux_user: 'acme',
  created_by: 'admin',
  owner_gateway: 'openclaw-main',
  status: 'active',
  plan_tier: 'standard',
  gateway_port: 8080,
  dashboard_port: 3000,
  created_at: now,
  latest_job_id: null,
  latest_job_status: null,
  ...overrides,
})

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  tenant_id: 1,
  tenant_slug: 'acme',
  tenant_display_name: 'Acme Corp',
  job_type: 'bootstrap',
  status: 'queued',
  dry_run: 1,
  requested_by: 'admin',
  approved_by: null,
  started_at: null,
  completed_at: null,
  error_text: null,
  created_at: now,
  ...overrides,
})

/** Resolve all pending fetch calls with successful tenant + job + gateway data. */
function mockSuccessfulLoad(
  tenants = [makeTenant()],
  jobs = [makeJob()],
  gateways: unknown[] = [],
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/super/tenants')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tenants }),
      })
    }
    if (url.includes('/api/super/provision-jobs')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs }),
      })
    }
    if (url.includes('/api/gateways')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ gateways }),
      })
    }
    // Fallback
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    })
  })
}

function mockFailedLoad(errorMessage = 'Server error') {
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: errorMessage }),
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SuperAdminPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    storeOverrides = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. Access denied for non-admins
  it('renders access denied for non-admin users', () => {
    storeOverrides = {
      currentUser: { id: 2, username: 'viewer', display_name: 'Viewer', role: 'viewer' },
    }
    mockSuccessfulLoad()
    render(<SuperAdminPanel />)
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
    expect(screen.getByText(/Super Mission Control requires admin privileges/i)).toBeInTheDocument()
  })

  // 2. Loading state
  it('renders loading state initially', () => {
    // Fetch never resolves
    mockFetch.mockReturnValue(new Promise(() => {}))
    render(<SuperAdminPanel />)
    expect(screen.getByText('Loading super admin data...')).toBeInTheDocument()
  })

  // 3. Tenant table renders after load
  it('renders tenant table after data loads', async () => {
    mockSuccessfulLoad()
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
    // 'acme' appears as both slug and linux_user columns
    expect(screen.getAllByText('acme').length).toBeGreaterThanOrEqual(1)
    // 'active' appears in both filter dropdown option and status span
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(1)
  })

  // 4. KPI cards render
  it('renders KPI cards with correct counts', async () => {
    const tenants = [
      makeTenant({ id: 1, status: 'active' }),
      makeTenant({ id: 2, slug: 'beta', display_name: 'Beta', status: 'active' }),
      makeTenant({ id: 3, slug: 'gamma', display_name: 'Gamma', status: 'error' }),
      makeTenant({ id: 4, slug: 'delta', display_name: 'Delta', status: 'pending' }),
    ]
    const jobs = [
      makeJob({ id: 10, status: 'queued' }),
      makeJob({ id: 11, status: 'queued' }),
    ]
    mockSuccessfulLoad(tenants, jobs)
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Active Tenants')).toBeInTheDocument()
    })

    // Active = 2, Pending = 1, Errored = 1, Queued = 2
    const kpiContainer = screen.getByText('Active Tenants').closest('div')!.parentElement!
    expect(within(kpiContainer).getByText('2')).toBeInTheDocument() // active

    expect(screen.getByText('Errored Tenants')).toBeInTheDocument()
    expect(screen.getByText('Queued Approvals')).toBeInTheDocument()
  })

  // 5. Tab switching between sections
  it('switches between tenants, jobs, and events tabs', async () => {
    mockSuccessfulLoad()
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    // Default tab is tenants - table caption should be present
    expect(screen.getByText('Tenant list')).toBeInTheDocument()

    // Switch to jobs tab
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: /jobs/i }))

    await waitFor(() => {
      // 'bootstrap' appears in both the type filter dropdown and the job row
      expect(screen.getAllByText(/bootstrap/i).length).toBeGreaterThanOrEqual(1)
    })
    // Verify the jobs table is visible via its caption
    expect(screen.getByText('Provisioning jobs')).toBeInTheDocument()
  })

  // 6. Create form validates required fields
  it('shows validation feedback when create form submitted without required fields', async () => {
    mockSuccessfulLoad()
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    // Open create form
    await user.click(screen.getByRole('button', { name: /Add Workspace/i }))

    await waitFor(() => {
      expect(screen.getByText('Create New Workspace')).toBeInTheDocument()
    })

    // Click create without filling fields
    await user.click(screen.getByRole('button', { name: /Create \+ Queue/i }))

    await waitFor(() => {
      expect(screen.getByText('Slug and display name are required')).toBeInTheDocument()
    })
  })

  // 7. Decommission dialog appearance
  it('opens decommission dialog when action button is clicked', async () => {
    mockSuccessfulLoad()
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    // Click the Actions button in the tenant row
    const actionsBtn = screen.getByRole('button', { name: 'Actions' })
    await user.click(actionsBtn)

    // Click Queue Decommission
    const decommissionBtn = await screen.findByRole('button', { name: /Queue Decommission/i })
    await user.click(decommissionBtn)

    await waitFor(() => {
      expect(screen.getByText(/Queue Decommission: Acme Corp/i)).toBeInTheDocument()
    })

    // Dialog should show dry-run option
    expect(screen.getByText(/Dry-run \(recommended\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Live execution/i)).toBeInTheDocument()
  })

  // 8. Empty state display
  it('renders empty state when no tenants match', async () => {
    mockSuccessfulLoad([], [])
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('No matching tenants.')).toBeInTheDocument()
    })
  })

  // 9. Error state handling
  it('renders error message when API call fails', async () => {
    mockFailedLoad('Database connection failed')
    render(<SuperAdminPanel />)

    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    })
  })
})
