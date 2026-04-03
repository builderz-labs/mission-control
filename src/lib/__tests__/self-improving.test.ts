/**
 * Tests for the Self-Improving Engine.
 * Covers: performance profiling, cost tracking, quality scoring,
 * improvement suggestions, and the SelfImprovingEngine singleton.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock setup — must come before module imports
// ---------------------------------------------------------------------------

const runMock = vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const execMock = vi.fn()
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: prepMock,
    exec: execMock,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/token-pricing', () => ({
  calculateTokenCost: vi.fn((_model: string, input: number, output: number) =>
    (input + output) * 0.000001
  ),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { selfImprovingEngine } from '../self-improving'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseline(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 1,
    operation_name: 'agent-invoke',
    baseline_ms: 200,
    current_avg_ms: 200,
    sample_count: 1,
    regression_detected: 0,
    workspace_id: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeCostRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent_id: 'agent-1',
    task_type: 'research',
    token_input: 1000,
    token_output: 500,
    cost_usd: 0.0015,
    duration_ms: 500,
    quality_score: 0.9,
    workspace_id: 1,
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    category: 'performance',
    severity: 'warning',
    title: 'Performance regression: agent-invoke',
    description: 'Operation "agent-invoke" is 30% slower than baseline.',
    evidence: null,
    status: 'pending',
    workspace_id: 1,
    created_at: Math.floor(Date.now() / 1000),
    resolved_at: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Engine initialization
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.initialize', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls ensureTables (CREATE TABLE IF NOT EXISTS statements)', () => {
    // Force re-initialization by resetting the internal flag via a fresh call
    selfImprovingEngine.initialize()
    // exec should have been called for CREATE TABLE statements
    expect(execMock).toHaveBeenCalled()
  })

  it('does not re-initialize when already initialized', () => {
    execMock.mockClear()
    selfImprovingEngine.initialize()
    const callCountFirstInit = execMock.mock.calls.length
    selfImprovingEngine.initialize()
    // No extra exec calls on second initialize
    expect(execMock.mock.calls.length).toBe(callCountFirstInit)
  })
})

// ---------------------------------------------------------------------------
// Performance profiling
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.recordPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined) // allow ensureTables
  })

  it('creates a new baseline on first sample', () => {
    getMock.mockReturnValue(undefined) // no existing baseline
    const result = selfImprovingEngine.recordPerformance({
      operation_name: 'agent-invoke',
      duration_ms: 200,
      workspace_id: 1,
    })
    expect(runMock).toHaveBeenCalledOnce()
    expect(result.operation_name).toBe('agent-invoke')
    expect(result.baseline_ms).toBe(200)
  })

  it('updates existing baseline with running average', () => {
    const existing = makeBaseline({ sample_count: 1, current_avg_ms: 200, baseline_ms: 200 })
    getMock.mockReturnValue(existing)
    const updated = makeBaseline({
      sample_count: 2,
      current_avg_ms: 225, // avg of 200 and 250
      regression_detected: 0,
    })
    // UPDATE returns nothing meaningful; next get returns updated
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })
    // The update function returns via spread from existing + updates
    const result = selfImprovingEngine.recordPerformance({
      operation_name: 'agent-invoke',
      duration_ms: 250,
      workspace_id: 1,
    })
    expect(result.sample_count).toBe(2)
  })

  it('marks regression when new avg exceeds 20% above baseline', () => {
    // baseline 100ms, new sample 200ms → avg becomes > 120ms → regression
    const existing = makeBaseline({ sample_count: 1, current_avg_ms: 100, baseline_ms: 100 })
    getMock.mockReturnValue(existing)
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })

    // The result is built from the update function which returns the computed regression
    const result = selfImprovingEngine.recordPerformance({
      operation_name: 'agent-invoke',
      duration_ms: 200,
      workspace_id: 1,
    })
    // new avg = 100 + (200-100)/2 = 150ms — 50% above baseline → regression
    expect(result.regression_detected).toBe(1)
    expect(result.current_avg_ms).toBeGreaterThan(100)
  })

  it('does not mark regression when new avg is within 20% of baseline', () => {
    const existing = makeBaseline({ sample_count: 1, current_avg_ms: 100, baseline_ms: 100 })
    getMock.mockReturnValue(existing)
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 0 })

    const result = selfImprovingEngine.recordPerformance({
      operation_name: 'agent-invoke',
      duration_ms: 110, // new avg = 105ms — within 20%
      workspace_id: 1,
    })
    expect(result.regression_detected).toBe(0)
  })
})

describe('selfImprovingEngine.getBaselines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns empty array when no baselines exist', () => {
    allMock.mockReturnValue([])
    expect(selfImprovingEngine.getBaselines(1)).toEqual([])
  })

  it('returns all baselines', () => {
    allMock.mockReturnValue([makeBaseline(), makeBaseline({ id: 2, operation_name: 'another-op' })])
    const results = selfImprovingEngine.getBaselines(1)
    expect(results).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.recordCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 1 })
  })

  it('inserts a cost record and returns it', () => {
    const result = selfImprovingEngine.recordCost({
      agent_id: 'agent-1',
      task_type: 'research',
      token_input: 1000,
      token_output: 500,
      workspace_id: 1,
    })
    expect(runMock).toHaveBeenCalledOnce()
    expect(result.agent_id).toBe('agent-1')
    expect(result.token_input).toBe(1000)
    expect(result.token_output).toBe(500)
  })

  it('calculates cost via calculateTokenCost when model_name provided', () => {
    const result = selfImprovingEngine.recordCost({
      agent_id: 'agent-1',
      model_name: 'claude-haiku',
      token_input: 1000,
      token_output: 500,
      workspace_id: 1,
    })
    // (1000 + 500) * 0.000001 = 0.0015
    expect(result.cost_usd).toBeCloseTo(0.0015, 6)
  })

  it('uses cost_usd 0 when no model_name provided', () => {
    const result = selfImprovingEngine.recordCost({
      agent_id: 'agent-1',
      token_input: 1000,
      token_output: 500,
      workspace_id: 1,
    })
    expect(result.cost_usd).toBe(0)
  })

  it('uses workspace_id 1 by default', () => {
    selfImprovingEngine.recordCost({
      agent_id: 'agent-1',
      token_input: 100,
      token_output: 50,
    })
    const insertArgs = runMock.mock.calls[0]
    // workspace_id is the last arg in the INSERT
    expect(insertArgs[insertArgs.length - 1]).toBe(1)
  })
})

describe('selfImprovingEngine.getCostByAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns empty array when no costs recorded', () => {
    allMock.mockReturnValue([])
    expect(selfImprovingEngine.getCostByAgent(1)).toEqual([])
  })

  it('returns aggregated cost summaries', () => {
    allMock.mockReturnValue([{
      agent_id: 'agent-1',
      total_cost: 0.05,
      total_input: 10000,
      total_output: 5000,
      avg_cost: 0.005,
      record_count: 10,
    }])
    const results = selfImprovingEngine.getCostByAgent(1)
    expect(results[0].agent_id).toBe('agent-1')
    expect(results[0].total_cost).toBe(0.05)
  })
})

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.getQualityScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns empty array when no quality data', () => {
    allMock.mockReturnValue([])
    expect(selfImprovingEngine.getQualityScores(1)).toEqual([])
  })

  it('returns quality summaries per agent', () => {
    allMock.mockReturnValue([{
      agent_id: 'agent-1',
      avg_quality: 0.85,
      min_quality: 0.7,
      max_quality: 0.95,
      record_count: 20,
    }])
    const results = selfImprovingEngine.getQualityScores(1)
    expect(results[0].avg_quality).toBe(0.85)
    expect(results[0].record_count).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Improvement suggestions
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.generateSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns empty array when no regressions or high-cost agents', () => {
    allMock.mockReturnValue([]) // no regressions, no cost data, no quality data
    const suggestions = selfImprovingEngine.generateSuggestions(1)
    expect(suggestions).toHaveLength(0)
  })

  it('creates performance suggestion when regression detected', () => {
    // First allMock call → getRegressions; subsequent calls → other data
    allMock
      .mockReturnValueOnce([makeBaseline({ regression_detected: 1, current_avg_ms: 300, baseline_ms: 200 })]) // regressions
      .mockReturnValueOnce([]) // getCostByAgent
      .mockReturnValueOnce([]) // getQualityScores
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 10 })

    const suggestions = selfImprovingEngine.generateSuggestions(1)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].category).toBe('performance')
  })

  it('creates cost warning for high-cost agents', () => {
    // COST_COMPARISON_THRESHOLD = 3.0: agent.avg_cost > mean * 3
    // With 4 agents (3 cheap @ 0.001 + 1 expensive @ 0.01):
    //   mean = (0.001*3 + 0.01)/4 = 0.00325
    //   expensive (0.01) > 0.00325 * 3 (0.00975) → triggers warning
    allMock
      .mockReturnValueOnce([]) // no regressions
      .mockReturnValueOnce([   // getCostByAgent — four agents, one clearly above 3x mean
        { agent_id: 'cheap1', avg_cost: 0.001, total_cost: 0.01, total_input: 1000, total_output: 500, record_count: 10 },
        { agent_id: 'cheap2', avg_cost: 0.001, total_cost: 0.01, total_input: 1000, total_output: 500, record_count: 10 },
        { agent_id: 'cheap3', avg_cost: 0.001, total_cost: 0.01, total_input: 1000, total_output: 500, record_count: 10 },
        { agent_id: 'expensive', avg_cost: 0.01, total_cost: 0.1, total_input: 1000, total_output: 500, record_count: 10 },
      ])
      .mockReturnValueOnce([]) // getQualityScores
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 11 })

    const suggestions = selfImprovingEngine.generateSuggestions(1)
    const costSuggestion = suggestions.find((s) => s.category === 'cost')
    expect(costSuggestion).toBeDefined()
    expect(costSuggestion!.severity).toBe('warning')
  })

  it('creates quality suggestion for low-scoring agents', () => {
    allMock
      .mockReturnValueOnce([]) // no regressions
      .mockReturnValueOnce([]) // getCostByAgent
      .mockReturnValueOnce([   // getQualityScores
        { agent_id: 'bad-agent', avg_quality: 0.2, min_quality: 0.1, max_quality: 0.3, record_count: 10 },
      ])
    runMock.mockReturnValue({ changes: 1, lastInsertRowid: 12 })

    const suggestions = selfImprovingEngine.generateSuggestions(1)
    const qualSuggestion = suggestions.find((s) => s.category === 'quality')
    expect(qualSuggestion).toBeDefined()
    expect(qualSuggestion!.severity).toBe('critical') // avg_quality < 0.3
  })
})

describe('selfImprovingEngine.getSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns all suggestions when no status filter', () => {
    allMock.mockReturnValue([makeSuggestion(), makeSuggestion({ id: 2, status: 'accepted' })])
    const results = selfImprovingEngine.getSuggestions(1)
    expect(results).toHaveLength(2)
  })

  it('filters suggestions by status', () => {
    allMock.mockReturnValue([makeSuggestion()])
    const results = selfImprovingEngine.getSuggestions(1, 'pending')
    expect(results[0].status).toBe('pending')
  })

  it('returns empty array when none match', () => {
    allMock.mockReturnValue([])
    expect(selfImprovingEngine.getSuggestions(1, 'implemented')).toEqual([])
  })
})

describe('selfImprovingEngine.updateSuggestionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('updates status to accepted', () => {
    getMock.mockReturnValue(makeSuggestion({ status: 'accepted' }))
    const result = selfImprovingEngine.updateSuggestionStatus(1, 'accepted', 1)
    expect(result!.status).toBe('accepted')
  })

  it('sets resolved_at when status is implemented', () => {
    const now = Math.floor(Date.now() / 1000)
    getMock.mockReturnValue(makeSuggestion({ status: 'implemented', resolved_at: now }))
    const result = selfImprovingEngine.updateSuggestionStatus(1, 'implemented', 1)
    expect(result!.resolved_at).not.toBeNull()
  })

  it('sets resolved_at when status is rejected', () => {
    const now = Math.floor(Date.now() / 1000)
    getMock.mockReturnValue(makeSuggestion({ status: 'rejected', resolved_at: now }))
    const result = selfImprovingEngine.updateSuggestionStatus(1, 'rejected', 1)
    expect(result!.resolved_at).not.toBeNull()
  })

  it('returns null when suggestion not found', () => {
    getMock.mockReturnValue(null)
    const result = selfImprovingEngine.updateSuggestionStatus(999, 'accepted', 1)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.analyzeTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
  })

  it('returns stable trend when no data points', () => {
    allMock.mockReturnValue([])
    const trend = selfImprovingEngine.analyzeTrend('cost', 'weekly', 1)
    expect(trend.trend_direction).toBe('stable')
    expect(trend.change_percent).toBe(0)
  })

  it('returns stable trend when only one data point', () => {
    allMock.mockReturnValue([{ bucket_ts: 1000, value: 0.05 }])
    const trend = selfImprovingEngine.analyzeTrend('cost', 'daily', 1)
    expect(trend.trend_direction).toBe('stable')
  })

  it('detects degrading trend when cost increases >5%', () => {
    allMock.mockReturnValue([
      { bucket_ts: 1000, value: 0.01 },
      { bucket_ts: 2000, value: 0.02 }, // 100% increase → degrading
    ])
    const trend = selfImprovingEngine.analyzeTrend('cost', 'weekly', 1)
    expect(trend.trend_direction).toBe('degrading')
    expect(trend.change_percent).toBeGreaterThan(5)
  })

  it('detects improving trend when cost decreases >5%', () => {
    allMock.mockReturnValue([
      { bucket_ts: 1000, value: 0.02 },
      { bucket_ts: 2000, value: 0.01 }, // 50% decrease → improving
    ])
    const trend = selfImprovingEngine.analyzeTrend('cost', 'weekly', 1)
    expect(trend.trend_direction).toBe('improving')
    expect(trend.change_percent).toBeLessThan(-5)
  })

  it('includes correct period in result', () => {
    allMock.mockReturnValue([])
    const trend = selfImprovingEngine.analyzeTrend('quality', 'monthly', 1)
    expect(trend.period).toBe('monthly')
    expect(trend.metric).toBe('quality')
  })
})

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe('selfImprovingEngine.getDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execMock.mockReturnValue(undefined)
    allMock.mockReturnValue([])
  })

  it('returns dashboard with all required sections', () => {
    const dashboard = selfImprovingEngine.getDashboard(1)
    expect(dashboard).toHaveProperty('baselines')
    expect(dashboard).toHaveProperty('regressions')
    expect(dashboard).toHaveProperty('cost_by_agent')
    expect(dashboard).toHaveProperty('cost_by_task_type')
    expect(dashboard).toHaveProperty('quality_scores')
    expect(dashboard).toHaveProperty('suggestions')
    expect(dashboard).toHaveProperty('trends')
  })

  it('trends include cost, performance, and quality', () => {
    const dashboard = selfImprovingEngine.getDashboard(1)
    expect(dashboard.trends).toHaveProperty('cost')
    expect(dashboard.trends).toHaveProperty('performance')
    expect(dashboard.trends).toHaveProperty('quality')
  })
})
