import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/navigation', () => ({
  useNavigateToPanel: () => vi.fn(),
}))

import { HermesPanel } from '@/components/panels/hermes-panel'

describe('HermesPanel', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a checking state before runtime finishes loading', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/hermes')) {
        await gate
        return {
          ok: true,
          json: async () => ({
            installed: true,
            gatewayRunning: true,
            activeSessions: 1,
            cronJobCount: 1,
            memoryEntries: 1,
            hookInstalled: true,
            automation: {
              active: true,
              label: 'Automation active',
              enabledJobs: 1,
              totalJobs: 1,
              latestJobId: 'hh-recovery-nightly',
              latestJobName: 'HH recovery nightly',
              latestRunAt: '2026-03-31T03:00:00.000Z',
            },
            hhRecovery: {
              state: 'missing',
              label: 'HH recovery has no recorded output',
              detail: 'No output yet.',
              jobId: 'hh-recovery-nightly',
              jobName: 'HH recovery nightly',
              lastRunAt: '2026-03-31T03:00:00.000Z',
            },
          }),
        } as Response
      }

      if (url.includes('/api/hermes/tasks')) {
        return {
          ok: true,
          json: async () => ({ cronJobs: [] }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({
          agentMemory: null,
          userMemory: null,
          agentMemoryEntries: 0,
          userMemoryEntries: 0,
          agentMemorySize: 0,
          userMemorySize: 0,
        }),
      } as Response
    })

    render(<HermesPanel />)

    expect(screen.getByText('Checking…')).toBeTruthy()

    release?.()

    await waitFor(() => {
      expect(screen.getByText('Installed')).toBeTruthy()
    })
  })

  it('renders Hermes runtime, HH recovery, cron jobs, and memory summaries together', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/hermes/tasks')) {
        return {
          ok: true,
          json: async () => ({
            cronJobs: [
              {
                id: 'hh-recovery-nightly',
                prompt: 'Run the Holy Hedgehog recovery loop',
                enabled: true,
                schedule: '0 3 * * *',
                lastRunAt: '2026-03-31T03:00:00.000Z',
              },
            ],
          }),
        } as Response
      }

      if (url.includes('/api/hermes/memory')) {
        return {
          ok: true,
          json: async () => ({
            agentMemory: '# MEMORY\n\n## OpenClaw\nHermes nightly recovery enabled',
            userMemory: '# USER\n\n## Preferences\nTelegram summary preferred',
            agentMemoryEntries: 4,
            userMemoryEntries: 1,
            agentMemorySize: 128,
            userMemorySize: 64,
          }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({
          installed: true,
          gatewayRunning: true,
          activeSessions: 2,
          cronJobCount: 1,
          memoryEntries: 4,
          hookInstalled: true,
          automation: {
            active: true,
            label: 'Automation active',
            enabledJobs: 1,
            totalJobs: 1,
            latestJobId: 'hh-recovery-nightly',
            latestJobName: 'HH recovery nightly',
            latestRunAt: '2026-03-31T03:00:00.000Z',
          },
          hhRecovery: {
            state: 'success',
            label: 'HH recovery completed',
            detail: 'HH recovery completed successfully.',
            jobId: 'hh-recovery-nightly',
            jobName: 'HH recovery nightly',
            lastRunAt: '2026-03-31T03:00:00.000Z',
          },
        }),
      } as Response
    })

    render(<HermesPanel />)

    expect(screen.getByText('Hermes Control')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('Automation active')).toBeTruthy()
      expect(screen.getByText('HH recovery completed')).toBeTruthy()
      expect(screen.getByText('Run the Holy Hedgehog recovery loop')).toBeTruthy()
      expect(screen.getByText('Hermes nightly recovery enabled')).toBeTruthy()
      expect(screen.getByText('Telegram summary preferred')).toBeTruthy()
    })
  })
})
