import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FlyOrchestrationPanel } from './fly-orchestration-panel'

vi.mock('@/lib/use-smart-poll', async () => {
  const { useEffect } = await import('react')
  return { useSmartPoll: (callback: () => Promise<void>) => useEffect(() => { void callback() }, [callback]) }
})
vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn(async () => ({
  status: 'healthy', mac: { cpu_percent: 28, memory_percent: 45, swap_bytes: 1_073_741_824 },
  queue: { queued: 3, local: 1, failed: 1 },
  fleet: { running: 2, capacity: 4, idle: 2, workers: [{ worker_class: 'browser-standard', running: 1, total: 2, cpu_percent: 75, memory_bytes: 2_147_483_648 }] },
  cost: { daily_spend: 1.25, daily_budget: 5, monthly_spend: 3.5, monthly_budget: 20, reserved_usd: 0.5 },
  bottlenecks: [{ label: 'Browser pool', detail: '1 worker starting', severity: 'warn' }],
})) }))

describe('FlyOrchestrationPanel', () => {
  it('renders the live flow, state transitions, worker classes, costs, and bottleneck', async () => {
    render(<FlyOrchestrationPanel />)
    await waitFor(() => expect(screen.getByText('3 queued')).toBeInTheDocument())
    expect(screen.getByText('28% CPU')).toBeInTheDocument()
    expect(screen.getAllByText('$3.50')).toHaveLength(2)
    expect(screen.getByLabelText('Live worker state transitions')).toBeInTheDocument()
    expect(screen.getByText('browser-standard')).toBeInTheDocument()
    expect(screen.getByText(/1.0 GB swap/)).toBeInTheDocument()
    expect(screen.getByText(/Browser pool/)).toBeInTheDocument()
  })
})
