import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryBrowserPanel } from '../memory-browser-panel'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Store mock -----------------------------------------------------------------
let storeState: Record<string, unknown> = {}

const storeDefaults = {
  memoryFiles: [] as any[],
  selectedMemoryFile: null as string | null,
  memoryContent: null as string | null,
  dashboardMode: 'full' as const,
  setMemoryFiles: vi.fn((files: any[]) => {
    storeState.memoryFiles = files
  }),
  setSelectedMemoryFile: vi.fn((path: string | null) => {
    storeState.selectedMemoryFile = path
  }),
  setMemoryContent: vi.fn((content: string | null) => {
    storeState.memoryContent = content
  }),
}

vi.mock('@/store', () => ({
  useMissionControl: () => ({ ...storeDefaults, ...storeState }),
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

// Global fetch ---------------------------------------------------------------
const mockFetch = vi.fn()
global.fetch = mockFetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeTree = () => [
  {
    path: 'knowledge',
    name: 'knowledge',
    type: 'directory' as const,
    children: [
      {
        path: 'knowledge/arch.md',
        name: 'arch.md',
        type: 'file' as const,
        size: 1024,
        modified: Date.now(),
      },
      {
        path: 'knowledge/api-reference.json',
        name: 'api-reference.json',
        type: 'file' as const,
        size: 2048,
        modified: Date.now(),
      },
    ],
  },
  {
    path: 'daily',
    name: 'daily',
    type: 'directory' as const,
    children: [
      {
        path: 'daily/2026-03-15.md',
        name: '2026-03-15.md',
        type: 'file' as const,
        size: 512,
        modified: Date.now(),
      },
    ],
  },
]

function mockDefaultFetch(tree = makeTree()) {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('action=tree')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tree }),
      })
    }
    if (typeof url === 'string' && url.includes('action=content')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: '# Test File\n\nThis is test content.',
          }),
      })
    }
    if (typeof url === 'string' && url.includes('action=search')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { path: 'knowledge/arch.md', name: 'arch.md', matches: 3 },
            ],
          }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MemoryBrowserPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState = {
      memoryFiles: [],
      selectedMemoryFile: null,
      memoryContent: null,
    }
    storeDefaults.setMemoryFiles.mockImplementation((files: any[]) => {
      storeState.memoryFiles = files
    })
    storeDefaults.setSelectedMemoryFile.mockImplementation((path: string | null) => {
      storeState.selectedMemoryFile = path
    })
    storeDefaults.setMemoryContent.mockImplementation((content: string | null) => {
      storeState.memoryContent = content
    })
  })

  // 1. Loading state
  it('renders loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    render(<MemoryBrowserPanel />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  // 2. File tree renders after load
  it('renders file tree after data loads', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    // Simulate store getting populated
    storeState.memoryFiles = tree
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText('knowledge')).toBeInTheDocument()
    })
    expect(screen.getByText('daily')).toBeInTheDocument()
  })

  // 3. File content display
  it('displays file content when a file is selected', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    storeState.memoryFiles = tree
    storeState.selectedMemoryFile = 'knowledge/arch.md'
    storeState.memoryContent = '# Architecture\n\nSystem overview.'

    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText(/Architecture/)).toBeInTheDocument()
    })
    // File path appears in both the heading and the file info line
    const filePathElements = screen.getAllByText(/knowledge\/arch\.md/)
    expect(filePathElements.length).toBeGreaterThanOrEqual(1)
    // Verify the rendered markdown content
    expect(screen.getByText(/System overview/)).toBeInTheDocument()
  })

  // 4. Search functionality
  it('triggers search and displays results', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    storeState.memoryFiles = tree
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search in memory files...')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    const searchInput = screen.getByPlaceholderText('Search in memory files...')
    await user.type(searchInput, 'architecture')
    await user.click(screen.getByRole('button', { name: /Search/i }))

    await waitFor(() => {
      expect(screen.getByText(/Search Results/i)).toBeInTheDocument()
    })
    // 'arch.md' may appear in both the file tree and search results
    const searchSection = screen.getByText(/Search Results/i).closest('div')!
    expect(within(searchSection).getByText('3 matches')).toBeInTheDocument()
    // Verify the search result item is present
    expect(screen.getAllByText('arch.md').length).toBeGreaterThanOrEqual(1)
  })

  // 5. Create file modal
  it('opens create file modal when New File button is clicked', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    storeState.memoryFiles = tree
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText('Memory Browser')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    // There are two "New File" / "+ New File" buttons
    const newFileButtons = screen.getAllByRole('button', { name: /New File/i })
    await user.click(newFileButtons[0])

    await waitFor(() => {
      // The modal heading "Create New File" should appear
      expect(screen.getByRole('heading', { name: 'Create New File' })).toBeInTheDocument()
    })

    // Modal should have file name input and directory selector
    expect(screen.getByPlaceholderText('my-new-file')).toBeInTheDocument()
    expect(screen.getByText('File Type')).toBeInTheDocument()
  })

  // 6. Tab switching
  it('switches between All Files, Daily Logs, and Knowledge tabs', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    storeState.memoryFiles = tree
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText('knowledge')).toBeInTheDocument()
    })

    const user = userEvent.setup()

    // Click "Daily Logs" tab
    await user.click(screen.getByRole('button', { name: /Daily Logs/i }))
    // The store's memoryFiles are still full but the filter should be active
    // "daily" folder should be visible, "knowledge" may be hidden in filtered view
    await waitFor(() => {
      expect(screen.getByText('daily')).toBeInTheDocument()
    })

    // Click "Knowledge" tab
    await user.click(screen.getByRole('button', { name: /Knowledge/i }))
    await waitFor(() => {
      expect(screen.getByText('knowledge')).toBeInTheDocument()
    })
  })

  // 7. File stats section renders
  it('renders memory statistics when files exist', async () => {
    const tree = makeTree()
    mockDefaultFetch(tree)
    storeState.memoryFiles = tree
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText('Memory Statistics')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Files')).toBeInTheDocument()
    expect(screen.getByText('Directories')).toBeInTheDocument()
    expect(screen.getByText('Total Size')).toBeInTheDocument()
  })

  // 8. Error handling - empty state when tree fetch fails
  it('handles fetch errors gracefully and shows empty state', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')))
    storeState.memoryFiles = []
    render(<MemoryBrowserPanel />)

    await waitFor(() => {
      expect(screen.getByText('No memory files found')).toBeInTheDocument()
    })
  })
})
