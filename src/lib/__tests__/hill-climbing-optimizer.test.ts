/**
 * Tests for src/lib/hill-climbing/optimizer.ts
 * WHY: Validates A/B comparison lifecycle — creation, outcome recording,
 * evaluation logic (winner/tie/confidence), and list query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const runMock = vi.fn((..._a: unknown[]) => ({ lastInsertRowid: 1, changes: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('../db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepMock })) }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { HillClimbingOptimizer } from '../hill-climbing/optimizer'
import type { TrajectoryComparison } from '../hill-climbing/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeComparison(valueA: number | null, valueB: number | null): TrajectoryComparison {
  return {
    id: 1, operation_name: 'test-op', config_a: '{}', config_b: '{}',
    metric_name: 'latency', value_a: valueA, value_b: valueB,
    winner: null, confidence: 0, workspace_id: 1, created_at: 0, resolved_at: null,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HillClimbingOptimizer', () => {
  let optimizer: HillClimbingOptimizer

  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>).__hillClimber
    optimizer = HillClimbingOptimizer.getInstance()
  })

  describe('proposeVariant', () => {
    it('returns an object with the same keys as the input', () => {
      const config = { temperature: 0.7, maxTokens: 1000, model: 'claude' }
      const variant = optimizer.proposeVariant(config)
      expect(Object.keys(variant)).toEqual(Object.keys(config))
    })

    it('does not mutate non-numeric fields', () => {
      const config = { model: 'claude', flag: true }
      const variant = optimizer.proposeVariant(config, { mutationRate: 1 })
      expect(variant.model).toBe('claude')
      expect(variant.flag).toBe(true)
    })

    it('preserves numeric values when mutationRate is 0', () => {
      const config = { temperature: 0.7, maxTokens: 1000 }
      const variant = optimizer.proposeVariant(config, { mutationRate: 0 })
      expect(variant.temperature).toBe(0.7)
      expect(variant.maxTokens).toBe(1000)
    })

    it('only mutates fields listed in options.fields', () => {
      const config = { temperature: 0.7, topP: 0.9 }
      // Run many times to reduce flakiness since mutation is probabilistic
      for (let i = 0; i < 20; i++) {
        const variant = optimizer.proposeVariant(config, { mutationRate: 1, fields: ['temperature'] })
        // topP should never be mutated
        expect(variant.topP).toBe(0.9)
      }
    })
  })

  describe('createComparison', () => {
    it('inserts a row and returns numeric ID', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 42, changes: 1 })
      const id = optimizer.createComparison('op', { a: 1 }, { a: 2 }, 'latency', 1)
      expect(id).toBe(42)
      expect(runMock).toHaveBeenCalledWith(
        'op', JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 }), 'latency', 1,
      )
    })
  })

  describe('recordOutcome', () => {
    it('updates value_a for variant a', () => {
      optimizer.recordOutcome({ comparisonId: 5, variant: 'a', value: 0.42 })
      expect(prepMock).toHaveBeenCalledWith(expect.stringContaining('value_a'))
      expect(runMock).toHaveBeenCalledWith(0.42, 5)
    })

    it('updates value_b for variant b', () => {
      optimizer.recordOutcome({ comparisonId: 5, variant: 'b', value: 0.88 })
      expect(prepMock).toHaveBeenCalledWith(expect.stringContaining('value_b'))
      expect(runMock).toHaveBeenCalledWith(0.88, 5)
    })
  })

  describe('evaluateComparison', () => {
    it('throws when comparison is not found', () => {
      getMock.mockReturnValueOnce(undefined)
      expect(() => optimizer.evaluateComparison(999)).toThrow('Hill-climbing comparison 999 not found')
    })

    it('throws when outcome values are missing', () => {
      getMock.mockReturnValueOnce(makeComparison(null, null))
      expect(() => optimizer.evaluateComparison(1)).toThrow('missing outcomes')
    })

    it('returns tie when |delta| is below MIN_WINNER_DELTA (0.05)', () => {
      getMock.mockReturnValueOnce(makeComparison(0.80, 0.82))  // delta = 0.02 < 0.05
      const result = optimizer.evaluateComparison(1)
      expect(result.winner).toBe('tie')
    })

    it('returns b as winner when value_b > value_a by more than 0.05', () => {
      getMock.mockReturnValueOnce(makeComparison(0.50, 0.80))  // delta = 0.30 > 0.05
      const result = optimizer.evaluateComparison(1)
      expect(result.winner).toBe('b')
      expect(result.delta).toBeCloseTo(0.30)
    })

    it('returns a as winner when value_a > value_b by more than 0.05', () => {
      getMock.mockReturnValueOnce(makeComparison(0.90, 0.50))
      const result = optimizer.evaluateComparison(1)
      expect(result.winner).toBe('a')
    })

    it('confidence is capped at MAX_CONFIDENCE (0.99)', () => {
      getMock.mockReturnValueOnce(makeComparison(0.01, 100))  // extreme delta → ratio ≈ 0.9999 > 0.99
      const result = optimizer.evaluateComparison(1)
      expect(result.confidence).toBeLessThanOrEqual(0.99)
    })

    it('persists winner and confidence with resolved_at timestamp', () => {
      getMock.mockReturnValueOnce(makeComparison(0.4, 0.9))
      optimizer.evaluateComparison(1)
      // UPDATE call should contain winner, confidence, comparisonId
      expect(runMock).toHaveBeenCalledWith('b', expect.any(Number), 1)
    })
  })

  describe('listComparisons', () => {
    it('queries with correct operationName, workspaceId, and limit', () => {
      allMock.mockReturnValueOnce([])
      optimizer.listComparisons('my-op', 3, 15)
      expect(allMock).toHaveBeenCalledWith('my-op', 3, 15)
    })
  })
})
