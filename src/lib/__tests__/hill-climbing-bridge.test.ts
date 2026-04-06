/**
 * Tests for src/lib/hill-climbing-feedback-bridge.ts
 * WHY: Validates that hill-climbing results correctly reinforce or decay
 * learned_patterns, and that bridgeComparisonToPattern is a no-op for ties.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const runMock = vi.fn((..._a: unknown[]) => ({ lastInsertRowid: 20, changes: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('./db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepMock })) }))
vi.mock('../db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepMock })) }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../autonomous-events', () => ({
  emitPatternStored: vi.fn(),
}))

import {
  reinforcePatternByAction,
  decayPatternByAction,
  bridgeComparisonToPattern,
} from '../hill-climbing-feedback-bridge'
import { emitPatternStored } from '../autonomous-events'
import { logger } from '../logger'
import type { ComparisonResult } from '../hill-climbing/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const bWinsResult: ComparisonResult = {
  winner: 'b', confidence: 0.8, valueA: 0.5, valueB: 0.9, delta: 0.4,
}

const tieResult: ComparisonResult = {
  winner: 'tie', confidence: 0.0, valueA: 0.8, valueB: 0.82, delta: 0.02,
}

const comparisonRow = {
  id: 1, operation_name: 'summarize', config_a: '{"t":0.7}', config_b: '{"t":0.5}',
  metric_name: 'quality', value_a: 0.5, value_b: 0.9,
  winner: 'b', confidence: 0.8, workspace_id: 1, created_at: 0, resolved_at: 0,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reinforcePatternByAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates confidence and usage_count for the matching action in workspace', () => {
    reinforcePatternByAction('my-action', 2)
    expect(prepMock).toHaveBeenCalledWith(expect.stringContaining('confidence + ?'))
    expect(runMock).toHaveBeenCalledWith(
      expect.any(Number), // MAX_CONFIDENCE
      expect.any(Number), // CONFIDENCE_BOOST_SUCCESS
      expect.any(Number), // now
      expect.any(Number), // now
      'my-action',
      2,
    )
  })
})

describe('decayPatternByAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('decreases confidence and increments usage_count for the matching action', () => {
    decayPatternByAction('bad-action', 1)
    expect(prepMock).toHaveBeenCalledWith(expect.stringContaining('confidence - ?'))
    expect(runMock).toHaveBeenCalledWith(
      expect.any(Number), // MIN_CONFIDENCE
      expect.any(Number), // CONFIDENCE_PENALTY_FAILURE
      expect.any(Number), // now
      'bad-action',
      1,
    )
  })
})

describe('bridgeComparisonToPattern', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns early without touching DB when winner is tie', () => {
    bridgeComparisonToPattern(1, tieResult, 1)
    // logger.debug is called, but no DB reads or writes
    expect(runMock).not.toHaveBeenCalled()
    expect(getMock).not.toHaveBeenCalled()
  })

  it('warns and returns when comparison row is not found', () => {
    getMock
      .mockReturnValueOnce(undefined)  // trajectory_comparisons lookup
    bridgeComparisonToPattern(99, bWinsResult, 1)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ comparisonId: 99 }),
      expect.any(String),
    )
    expect(runMock).not.toHaveBeenCalled()
  })

  it('reinforces an existing pattern and emits patternStored', () => {
    getMock
      .mockReturnValueOnce(comparisonRow)       // trajectory_comparisons lookup
      .mockReturnValueOnce({ id: 7 })           // existing learned_patterns lookup
    bridgeComparisonToPattern(1, bWinsResult, 1)
    // reinforcePatternByAction calls UPDATE — check it ran
    expect(runMock).toHaveBeenCalled()
    expect(emitPatternStored).toHaveBeenCalledWith(7, 'hill_climbing', expect.any(Number))
  })

  it('inserts a new pattern and emits patternStored when none exists', () => {
    runMock.mockReturnValueOnce({ lastInsertRowid: 55, changes: 1 })
    getMock
      .mockReturnValueOnce(comparisonRow)  // trajectory_comparisons lookup
      .mockReturnValueOnce(undefined)      // no existing learned_patterns
    bridgeComparisonToPattern(1, bWinsResult, 1)
    expect(runMock).toHaveBeenCalled()
    expect(emitPatternStored).toHaveBeenCalledWith(55, 'hill_climbing', expect.any(Number))
  })

  it('uses config_b as winning config when variant b wins', () => {
    getMock
      .mockReturnValueOnce(comparisonRow)
      .mockReturnValueOnce(undefined)  // no existing pattern → INSERT
    bridgeComparisonToPattern(1, bWinsResult, 1)
    // The INSERT should include config_b value as trigger_context
    expect(runMock).toHaveBeenCalledWith(
      comparisonRow.config_b, // winning config JSON
      expect.any(String),     // actionTaken
      expect.any(Number),     // confidence
      expect.any(Number),     // now (last_used_at)
      1,                      // workspaceId
      expect.any(Number),     // now (created_at)
      expect.any(Number),     // now (updated_at)
    )
  })
})
