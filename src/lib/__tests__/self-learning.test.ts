/**
 * Tests for the Self-Learning Engine.
 * All DB interactions are fully mocked — no live SQLite required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock setup — must come before module imports
// ---------------------------------------------------------------------------

const runMock = vi.fn((..._args: unknown[]) => ({ lastInsertRowid: 1, changes: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepMock })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  recordPattern,
  recordExecutionTrace,
  recordFeedback,
  getRecentFeedback,
  getTopPatterns,
  getSuccessfulTraces,
  findSimilarTraces,
  getLearningStats,
  isNovelProblem,
  getNovelProblemCount,
  applyDecay,
  refreshPatternUsage,
  markFeedbackApplied,
  findExistingPattern,
  recordOrReinforcePattern,
  suggestPatterns,
  getPatternById,
} from '../self-learning'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    pattern_type: 'task_routing',
    trigger_context: 'route user request to agent',
    action_taken: 'delegate to CSO',
    outcome: 'success',
    confidence: 0.6,
    usage_count: 1,
    last_used_at: 1000,
    decay_factor: 1.0,
    workspace_id: 1,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeFeedback(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    task_id: null,
    pattern_id: 1,
    rating: 5,
    correction: null,
    applied: 0,
    workspace_id: 1,
    created_at: 1000,
    ...overrides,
  }
}

function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    task_id: 1,
    agent_id: 'agent-1',
    action_sequence: 'fetch -> process -> respond',
    input_context: 'handle incoming task',
    output_result: 'task completed',
    duration_ms: 250,
    token_cost: 100,
    success: 1,
    workspace_id: 1,
    created_at: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// recordPattern
// ---------------------------------------------------------------------------

describe('recordPattern', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // getPatternById is called after insert; return the inserted pattern
    getMock.mockReturnValue(makePattern())
  })

  it('inserts a success pattern with confidence 0.6', () => {
    const result = recordPattern({
      patternType: 'task_routing',
      triggerContext: 'route user request to agent',
      actionTaken: 'delegate to CSO',
      outcome: 'success',
    })
    expect(runMock).toHaveBeenCalledOnce()
    const insertArgs = runMock.mock.calls[0]
    // outcome is at index 3
    expect(insertArgs[3]).toBe('success')
    // confidence at index 4 should be 0.6 for success
    expect(insertArgs[4]).toBe(0.6)
    expect(result.id).toBe(1)
  })

  it('inserts a partial pattern with confidence 0.4', () => {
    getMock.mockReturnValue(makePattern({ outcome: 'partial', confidence: 0.4 }))
    recordPattern({
      patternType: 'task_routing',
      triggerContext: 'partially done',
      actionTaken: 'partial action',
      outcome: 'partial',
    })
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[3]).toBe('partial')
    expect(insertArgs[4]).toBe(0.4)
  })

  it('inserts a failure pattern with confidence 0.2', () => {
    getMock.mockReturnValue(makePattern({ outcome: 'failure', confidence: 0.2 }))
    recordPattern({
      patternType: 'task_routing',
      triggerContext: 'failed action',
      actionTaken: 'bad delegate',
      outcome: 'failure',
    })
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[3]).toBe('failure')
    expect(insertArgs[4]).toBe(0.2)
  })

  it('uses workspaceId 1 by default', () => {
    recordPattern({
      patternType: 'test',
      triggerContext: 'ctx',
      actionTaken: 'action',
      outcome: 'success',
    })
    // INSERT args: (patternType[0], triggerContext[1], actionTaken[2], outcome[3], confidence[4], now[5], workspaceId[6], now[7], now[8])
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[6]).toBe(1)
  })

  it('uses custom workspaceId when provided', () => {
    recordPattern({
      patternType: 'test',
      triggerContext: 'ctx',
      actionTaken: 'action',
      outcome: 'success',
      workspaceId: 42,
    })
    // INSERT args: (patternType[0], triggerContext[1], actionTaken[2], outcome[3], confidence[4], now[5], workspaceId[6], now[7], now[8])
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[6]).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// getPatternById
// ---------------------------------------------------------------------------

describe('getPatternById', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns pattern when found', () => {
    getMock.mockReturnValue(makePattern())
    const result = getPatternById(1, 1)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
  })

  it('returns null when not found', () => {
    getMock.mockReturnValue(undefined)
    const result = getPatternById(999, 1)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getTopPatterns
// ---------------------------------------------------------------------------

describe('getTopPatterns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no patterns exist', () => {
    allMock.mockReturnValue([])
    const result = getTopPatterns(1)
    expect(result).toEqual([])
  })

  it('returns sorted patterns', () => {
    const patterns = [makePattern({ id: 1 }), makePattern({ id: 2 })]
    allMock.mockReturnValue(patterns)
    const result = getTopPatterns(1)
    expect(result).toHaveLength(2)
  })

  it('passes limit to the query', () => {
    allMock.mockReturnValue([])
    getTopPatterns(1, 5)
    // The all() mock is invoked with (workspaceId, MIN_CONFIDENCE, limit)
    expect(allMock).toHaveBeenCalledWith(1, expect.any(Number), 5)
  })
})

// ---------------------------------------------------------------------------
// suggestPatterns
// ---------------------------------------------------------------------------

describe('suggestPatterns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no candidates found', () => {
    allMock.mockReturnValue([])
    const suggestions = suggestPatterns('user request', 'task_routing', 1)
    expect(suggestions).toHaveLength(0)
  })

  it('returns suggestions with relevance score > 0 for keyword matches', () => {
    const pattern = makePattern({
      trigger_context: 'handle user request routing',
      decay_factor: 1.0,
      confidence: 0.8,
    })
    allMock.mockReturnValue([pattern])
    const suggestions = suggestPatterns('user request routing', 'task_routing', 1)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].relevanceScore).toBeGreaterThan(0)
  })

  it('filters out candidates with zero relevance', () => {
    const pattern = makePattern({ trigger_context: 'xyz abc def' })
    allMock.mockReturnValue([pattern])
    // No keyword overlap with 'completely different topic'
    const suggestions = suggestPatterns('completely different topic', 'task_routing', 1)
    // The keywords "completely", "different", "topic" won't match "xyz", "abc", "def"
    expect(suggestions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// recordExecutionTrace
// ---------------------------------------------------------------------------

describe('recordExecutionTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockReturnValue(makeTrace())
  })

  it('inserts a trace and returns it', () => {
    const result = recordExecutionTrace({
      taskId: 1,
      agentId: 'agent-1',
      actionSequence: 'fetch -> process -> respond',
      inputContext: 'handle incoming task',
      outputResult: 'task completed',
      durationMs: 250,
      success: true,
    })
    expect(runMock).toHaveBeenCalledOnce()
    expect(result.id).toBe(1)
  })

  it('stores success as integer 1', () => {
    recordExecutionTrace({
      actionSequence: 'seq',
      inputContext: 'ctx',
      outputResult: 'out',
      durationMs: 100,
      success: true,
    })
    const insertArgs = runMock.mock.calls[0]
    // success is at index 7
    expect(insertArgs[7]).toBe(1)
  })

  it('stores failure as integer 0', () => {
    getMock.mockReturnValue(makeTrace({ success: 0 }))
    recordExecutionTrace({
      actionSequence: 'seq',
      inputContext: 'ctx',
      outputResult: 'out',
      durationMs: 100,
      success: false,
    })
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[7]).toBe(0)
  })

  it('uses null for optional taskId and agentId when not provided', () => {
    recordExecutionTrace({
      actionSequence: 'seq',
      inputContext: 'ctx',
      outputResult: 'out',
      durationMs: 100,
      success: true,
    })
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[0]).toBeNull() // task_id
    expect(insertArgs[1]).toBeNull() // agent_id
  })

  it('uses tokenCost 0 by default', () => {
    recordExecutionTrace({
      actionSequence: 'seq',
      inputContext: 'ctx',
      outputResult: 'out',
      durationMs: 100,
      success: true,
    })
    const insertArgs = runMock.mock.calls[0]
    expect(insertArgs[6]).toBe(0) // token_cost
  })
})

// ---------------------------------------------------------------------------
// getSuccessfulTraces
// ---------------------------------------------------------------------------

describe('getSuccessfulTraces', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no successful traces exist', () => {
    allMock.mockReturnValue([])
    expect(getSuccessfulTraces()).toEqual([])
  })

  it('returns array of traces', () => {
    allMock.mockReturnValue([makeTrace(), makeTrace({ id: 2 })])
    const result = getSuccessfulTraces()
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// findSimilarTraces (experience replay)
// ---------------------------------------------------------------------------

describe('findSimilarTraces', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array for empty context', () => {
    const result = findSimilarTraces('', 1, 5)
    expect(result).toEqual([])
    // Should short-circuit without hitting the DB
    expect(prepMock).not.toHaveBeenCalled()
  })

  it('returns empty array when no candidates match', () => {
    allMock.mockReturnValue([makeTrace({ input_context: 'completely unrelated context' })])
    const result = findSimilarTraces('specific unique query xyz', 1, 5)
    expect(result).toHaveLength(0)
  })

  it('ranks traces by keyword overlap', () => {
    const highOverlap = makeTrace({ id: 1, input_context: 'user request routing task agent' })
    const lowOverlap = makeTrace({ id: 2, input_context: 'user unrelated stuff' })
    allMock.mockReturnValue([lowOverlap, highOverlap])
    const result = findSimilarTraces('user request routing task', 1, 5)
    // highOverlap has more keyword matches and should come first
    expect(result[0].id).toBe(1)
  })

  it('respects limit parameter', () => {
    const traces = Array.from({ length: 10 }, (_, i) =>
      makeTrace({ id: i + 1, input_context: 'user request task process' })
    )
    allMock.mockReturnValue(traces)
    const result = findSimilarTraces('user request task', 1, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// recordFeedback
// ---------------------------------------------------------------------------

describe('recordFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock
      .mockReturnValueOnce(makePattern()) // getPatternById in updatePatternFromFeedback
      .mockReturnValueOnce(makeFeedback()) // getFeedbackById at return
  })

  it('inserts feedback and returns it', () => {
    const result = recordFeedback({ rating: 5, patternId: 1 })
    expect(runMock).toHaveBeenCalled()
    expect(result.rating).toBe(5)
  })

  it('throws when rating < 1', () => {
    expect(() => recordFeedback({ rating: 0 })).toThrow('Rating must be between 1 and 5')
  })

  it('throws when rating > 5', () => {
    expect(() => recordFeedback({ rating: 6 })).toThrow('Rating must be between 1 and 5')
  })

  it('accepts boundary rating 1', () => {
    getMock.mockReset()
    getMock.mockReturnValue(makeFeedback({ rating: 1 }))
    expect(() => recordFeedback({ rating: 1 })).not.toThrow()
  })

  it('accepts boundary rating 5', () => {
    getMock.mockReset()
    getMock
      .mockReturnValueOnce(makePattern())
      .mockReturnValueOnce(makeFeedback({ rating: 5 }))
    expect(() => recordFeedback({ rating: 5, patternId: 1 })).not.toThrow()
  })

  it('updates pattern confidence when patternId is provided', () => {
    recordFeedback({ rating: 5, patternId: 1 })
    // prepare called for: INSERT feedback + getPatternById + UPDATE pattern + getFeedbackById
    expect(prepMock).toHaveBeenCalledTimes(4)
  })

  it('does not update pattern confidence when patternId is absent', () => {
    getMock.mockReset()
    getMock.mockReturnValue(makeFeedback({ pattern_id: null }))
    recordFeedback({ rating: 5 })
    // prepare called for: INSERT feedback + getFeedbackById only (no pattern update)
    expect(prepMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// getRecentFeedback
// ---------------------------------------------------------------------------

describe('getRecentFeedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no feedback', () => {
    allMock.mockReturnValue([])
    expect(getRecentFeedback()).toEqual([])
  })

  it('returns feedback entries', () => {
    allMock.mockReturnValue([makeFeedback(), makeFeedback({ id: 2 })])
    expect(getRecentFeedback()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// markFeedbackApplied
// ---------------------------------------------------------------------------

describe('markFeedbackApplied', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockReturnValue(makeFeedback({ applied: 1 }))
  })

  it('marks feedback as applied and returns updated entry', () => {
    const result = markFeedbackApplied(1)
    expect(runMock).toHaveBeenCalledOnce()
    expect(result!.applied).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// applyDecay
// ---------------------------------------------------------------------------

describe('applyDecay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runMock.mockReturnValue({ changes: 3, lastInsertRowid: 0 })
  })

  it('returns number of decayed patterns', () => {
    const count = applyDecay(1)
    expect(count).toBe(3)
  })

  it('returns 0 when no patterns were decayed', () => {
    runMock.mockReturnValue({ changes: 0, lastInsertRowid: 0 })
    expect(applyDecay(1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// refreshPatternUsage
// ---------------------------------------------------------------------------

describe('refreshPatternUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockReturnValue(makePattern({ usage_count: 2 }))
  })

  it('updates and returns the refreshed pattern', () => {
    const result = refreshPatternUsage(1, 1)
    expect(runMock).toHaveBeenCalledOnce()
    expect(result!.usage_count).toBe(2)
  })

  it('returns null if pattern does not exist', () => {
    getMock.mockReturnValue(undefined)
    const result = refreshPatternUsage(999, 1)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isNovelProblem
// ---------------------------------------------------------------------------

describe('isNovelProblem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when no similar patterns exist', () => {
    allMock.mockReturnValue([])
    expect(isNovelProblem('task_routing', 'completely novel context xyz', 1)).toBe(true)
  })

  it('returns false when relevant patterns are found', () => {
    const pattern = makePattern({ trigger_context: 'route user request', decay_factor: 1.0, confidence: 0.8 })
    allMock.mockReturnValue([pattern])
    // Same keywords will produce a relevance score > 0
    expect(isNovelProblem('task_routing', 'route user request', 1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getNovelProblemCount
// ---------------------------------------------------------------------------

describe('getNovelProblemCount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns count of novel (low-confidence, low-usage) patterns', () => {
    getMock.mockReturnValue({ count: 7 })
    expect(getNovelProblemCount(1)).toBe(7)
  })

  it('returns 0 when there are no novel problems', () => {
    getMock.mockReturnValue({ count: 0 })
    expect(getNovelProblemCount(1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getLearningStats
// ---------------------------------------------------------------------------

describe('getLearningStats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns zeroed stats when DB is empty', () => {
    getMock
      .mockReturnValueOnce({ total: 0, avg_confidence: null, success_count: 0 })
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValueOnce({ total: 0, avg_rating: null })
      .mockReturnValueOnce({ count: 0 }) // getNovelProblemCount
    const stats = getLearningStats(1)
    expect(stats.totalPatterns).toBe(0)
    expect(stats.successRate).toBe(0)
    expect(stats.averageConfidence).toBe(0)
    expect(stats.totalTraces).toBe(0)
    expect(stats.totalFeedback).toBe(0)
    expect(stats.recentFeedbackAvgRating).toBe(0)
  })

  it('computes success rate correctly', () => {
    getMock
      .mockReturnValueOnce({ total: 10, avg_confidence: 0.65, success_count: 8 })
      .mockReturnValueOnce({ count: 50 })
      .mockReturnValueOnce({ total: 5, avg_rating: 4.2 })
      .mockReturnValueOnce({ count: 2 })
    const stats = getLearningStats(1)
    expect(stats.successRate).toBe(0.8)
    expect(stats.totalPatterns).toBe(10)
    expect(stats.totalTraces).toBe(50)
    expect(stats.totalFeedback).toBe(5)
    expect(stats.novelProblemsCount).toBe(2)
  })

  it('rounds averageConfidence to 3 decimal places', () => {
    getMock
      .mockReturnValueOnce({ total: 1, avg_confidence: 0.666666, success_count: 1 })
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValueOnce({ total: 0, avg_rating: null })
      .mockReturnValueOnce({ count: 0 })
    const stats = getLearningStats(1)
    expect(stats.averageConfidence).toBe(0.667)
  })
})

// ---------------------------------------------------------------------------
// findExistingPattern
// ---------------------------------------------------------------------------

describe('findExistingPattern', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns existing pattern when found', () => {
    getMock.mockReturnValue(makePattern())
    const result = findExistingPattern('task_routing', 'delegate to CSO')
    expect(result).not.toBeNull()
    expect(result!.action_taken).toBe('delegate to CSO')
  })

  it('returns null when not found', () => {
    getMock.mockReturnValue(undefined)
    const result = findExistingPattern('unknown_type', 'no such action')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// recordOrReinforcePattern
// ---------------------------------------------------------------------------

describe('recordOrReinforcePattern', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a new pattern when none exists', () => {
    // findExistingPattern returns null → new insert
    getMock
      .mockReturnValueOnce(undefined) // findExistingPattern
      .mockReturnValueOnce(makePattern()) // getPatternById after insert
    recordOrReinforcePattern({
      patternType: 'task_routing',
      triggerContext: 'new context',
      actionTaken: 'new action',
      outcome: 'success',
    })
    expect(runMock).toHaveBeenCalledOnce() // one INSERT
  })

  it('reinforces an existing pattern with a success outcome', () => {
    const existing = makePattern({ confidence: 0.6 })
    getMock
      .mockReturnValueOnce(existing) // findExistingPattern
      .mockReturnValueOnce(makePattern({ confidence: 0.7 })) // getPatternById after update
    const result = recordOrReinforcePattern({
      patternType: 'task_routing',
      triggerContext: 'existing context',
      actionTaken: 'delegate to CSO',
      outcome: 'success',
    })
    expect(runMock).toHaveBeenCalledOnce() // one UPDATE
    expect(result.confidence).toBe(0.7)
  })
})
