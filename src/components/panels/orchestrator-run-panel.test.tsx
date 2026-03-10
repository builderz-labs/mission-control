import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestratorRunPanel } from '@/components/panels/orchestrator-run-panel'

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response
}

describe('OrchestratorRunPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows broken projects separately and disables Run Task for them', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/orchestrator') {
        return Promise.resolve(jsonResponse({
          projects: [
            {
              id: 1,
              name: 'Broken Orchestrator',
              folder: 'D:\\missing\\ai-orchestrator',
              description: 'broken',
              created_at: 1,
              updated_at: 1,
              folder_exists: false,
              runnable: false,
              issue: 'Folder does not exist',
            },
          ],
          runs: [],
        }))
      }

      if (url === '/api/agents') {
        return Promise.resolve(jsonResponse({ agents: [] }))
      }

      if (url.startsWith('/api/settings')) {
        return Promise.resolve(jsonResponse({ settings: [] }))
      }

      if (url.startsWith('/api/orchestrator?project_id=1')) {
        return Promise.resolve(jsonResponse({
          error: 'Folder does not exist',
          project: {
            id: 1,
            name: 'Broken Orchestrator',
            folder: 'D:\\missing\\ai-orchestrator',
            description: 'broken',
            created_at: 1,
            updated_at: 1,
            folder_exists: false,
            runnable: false,
            issue: 'Folder does not exist',
          },
          suggestedFiles: [],
        }, false, 409))
      }

      return Promise.resolve(jsonResponse({}))
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<OrchestratorRunPanel />)

    expect(await screen.findByText('Broken projects')).toBeInTheDocument()
    expect(screen.getByText('Broken Orchestrator')).toBeInTheDocument()
    expect(screen.getByText('Folder does not exist')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run task/i })).toBeDisabled()
    })
  })
})
