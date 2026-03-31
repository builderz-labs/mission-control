import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const getDatabaseMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/agent-evals', () => ({
  runOutputEvals: vi.fn(),
  evalReasoningCoherence: vi.fn(),
  evalToolReliability: vi.fn(),
  runDriftCheck: vi.fn(() => []),
  getDriftTimeline: vi.fn(() => []),
}))

describe('GET /api/agents/evals', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRoleMock.mockReset()
    getDatabaseMock.mockReset()
    requireRoleMock.mockReturnValue({ user: { workspace_id: 1, username: 'j2w', role: 'admin' } })
  })

  it('returns aggregate security dashboard data when no agent is specified', async () => {
    getDatabaseMock.mockReturnValue({
      prepare: (query: string) => {
        if (!query.includes('FROM eval_runs e')) {
          throw new Error(`Unexpected query: ${query}`)
        }
        return {
          all: () => ([
            { agent_name: 'main', eval_layer: 'output', score: 0.92, passed: 1, detail: 'ok', created_at: 1000 },
            { agent_name: 'main', eval_layer: 'drift', score: 0.4, passed: 0, detail: 'metric: DRIFTED', created_at: 1001 },
            { agent_name: 'selector', eval_layer: 'output', score: 0.88, passed: 1, detail: 'ok', created_at: 1002 },
            { agent_name: 'selector', eval_layer: 'component', score: 0.7, passed: 1, detail: 'ok', created_at: 1003 },
          ]),
        }
      },
    })

    const { GET } = await import('@/app/api/agents/evals/route')
    const response = await GET(new NextRequest('http://localhost/api/agents/evals'))
    const payload = await response.json()

    expect(payload.overallConvergence).toBe(73)
    expect(payload.driftAlerts).toEqual(['main: drift detected in latest evals'])
    expect(payload.agents).toHaveLength(2)
    expect(payload.agents[0]).toMatchObject({
      name: 'main',
      driftDetected: true,
      convergence: 66,
    })
    expect(payload.agents[0].scores).toEqual(
      expect.arrayContaining([
        { layer: 'drift', score: 40, maxScore: 100 },
        { layer: 'output', score: 92, maxScore: 100 },
      ])
    )
  })
})
