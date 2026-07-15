import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn((..._args: unknown[]) => undefined as any)
const mockAll = vi.fn(() => [])
const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
const mockPrepare = vi.fn((_sql: string) => ({ get: mockGet, all: mockAll, run: mockRun }))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ prepare: mockPrepare }),
}))

import { convergenceScore, checkDrift, evalTaskCompletion, evalCorrectnessScore, runDriftCheck } from '@/lib/agent-evals'

describe('convergenceScore', () => {
  it('returns score 1.0 when no unique tools', () => {
    const result = convergenceScore(0, 0)
    expect(result.score).toBe(1.0)
    expect(result.looping).toBe(false)
  })

  it('returns score 1.0 when ratio is 1:1', () => {
    const result = convergenceScore(5, 5)
    expect(result.score).toBe(1.0)
    expect(result.looping).toBe(false)
  })

  it('returns score 1.0 when ratio is exactly 3:1', () => {
    const result = convergenceScore(15, 5)
    expect(result.score).toBe(1.0)
    expect(result.looping).toBe(false)
  })

  it('detects looping when ratio exceeds 3:1', () => {
    const result = convergenceScore(20, 5)
    expect(result.looping).toBe(true)
    expect(result.score).toBeLessThan(1.0)
  })

  it('returns lower score with higher ratio', () => {
    const low = convergenceScore(6, 5)
    const high = convergenceScore(30, 5)
    expect(high.score).toBeLessThan(low.score)
  })

  it('clamps score between 0 and 1', () => {
    const result = convergenceScore(1000, 1)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})

describe('checkDrift', () => {
  it('returns no drift when current equals baseline', () => {
    const result = checkDrift(0.8, 0.8)
    expect(result.drifted).toBe(false)
    expect(result.delta).toBe(0)
  })

  it('detects drift when delta exceeds threshold', () => {
    const result = checkDrift(0.5, 0.8, 0.10)
    expect(result.drifted).toBe(true)
    expect(result.delta).toBeGreaterThan(0.10)
  })

  it('returns no drift when delta is within threshold', () => {
    const result = checkDrift(0.79, 0.8, 0.10)
    expect(result.drifted).toBe(false)
  })

  it('handles zero baseline correctly', () => {
    const result = checkDrift(0.5, 0)
    expect(result.drifted).toBe(true)
    expect(result.delta).toBe(1.0)
  })

  it('handles both zero correctly', () => {
    const result = checkDrift(0, 0)
    expect(result.drifted).toBe(false)
    expect(result.delta).toBe(0)
  })

  it('uses default threshold of 0.10', () => {
    const result = checkDrift(0.95, 0.8)
    // delta = |0.95 - 0.8| / 0.8 = 0.1875
    expect(result.drifted).toBe(true)
    expect(result.threshold).toBe(0.10)
  })
})

describe('workspace-scoped drift metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(undefined)
  })

  it('binds workspace ownership to every token-usage window', () => {
    runDriftCheck('shared-name', 42)

    const tokenQueries = mockPrepare.mock.calls
      .filter(([sql]) => String(sql).includes('FROM token_usage'))
    expect(tokenQueries).toHaveLength(2)
    for (const [sql] of tokenQueries) {
      expect(sql).toContain('workspace_id = ?')
    }

    const tokenGets = mockGet.mock.calls.slice(0, 2) as unknown[][]
    expect(tokenGets[0][0]).toBe('shared-name')
    expect(tokenGets[0][1]).toBe(42)
    expect(tokenGets[1][0]).toBe('shared-name')
    expect(tokenGets[1][1]).toBe(42)
  })
})

describe('evalTaskCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns score based on completed/total ratio', () => {
    mockGet.mockReturnValue({ total: 10, completed: 7, successful: 5 })
    const result = evalTaskCompletion('test-agent', 168, 1)
    expect(result.layer).toBe('output')
    expect(result.score).toBe(0.7)
    expect(result.passed).toBe(true)
  })

  it('returns score 1.0 when no tasks exist', () => {
    mockGet.mockReturnValue({ total: 0, completed: 0, successful: 0 })
    const result = evalTaskCompletion('new-agent', 168, 1)
    expect(result.score).toBe(1.0)
    expect(result.passed).toBe(true)
  })

  it('fails when completion rate is below 70%', () => {
    mockGet.mockReturnValue({ total: 10, completed: 5, successful: 3 })
    const result = evalTaskCompletion('slow-agent', 168, 1)
    expect(result.score).toBe(0.5)
    expect(result.passed).toBe(false)
  })
})

describe('evalCorrectnessScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success rate when no feedback ratings', () => {
    mockGet.mockReturnValue({ total: 10, successful: 8, avg_rating: null })
    const result = evalCorrectnessScore('test-agent', 168, 1)
    expect(result.layer).toBe('output')
    expect(result.score).toBe(0.8)
    expect(result.passed).toBe(true)
  })

  it('blends success rate with feedback rating', () => {
    mockGet.mockReturnValue({ total: 10, successful: 10, avg_rating: 4.0 })
    const result = evalCorrectnessScore('rated-agent', 168, 1)
    // score = 1.0 * 0.6 + ((4-1)/4) * 0.4 = 0.6 + 0.3 = 0.9
    expect(result.score).toBe(0.9)
    expect(result.passed).toBe(true)
  })

  it('fails when score is below 0.6', () => {
    mockGet.mockReturnValue({ total: 10, successful: 3, avg_rating: null })
    const result = evalCorrectnessScore('bad-agent', 168, 1)
    expect(result.score).toBe(0.3)
    expect(result.passed).toBe(false)
  })
})
