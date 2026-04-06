/**
 * Tests for src/lib/governance/gate.ts
 * WHY: Validates dimension scoring, pass/fail thresholds, override handling,
 * gate event emission, and upsert behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const runMock = vi.fn((..._a: unknown[]) => ({ lastInsertRowid: 10, changes: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))

vi.mock('../db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepMock })) }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../autonomous-events', () => ({
  emitGatePassed: vi.fn(),
  emitGateFailed: vi.fn(),
  emitReviewRequired: vi.fn(),
}))

import { GovernanceGateEngine } from '../governance/gate'
import { emitGatePassed, emitGateFailed, emitReviewRequired } from '../autonomous-events'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const allHighScores = [
  { dimension: 'correctness' as const, score: 0.9 },
  { dimension: 'completeness' as const, score: 0.9 },
  { dimension: 'style' as const, score: 0.9 },
  { dimension: 'security' as const, score: 0.9 },
]

const allLowScores = [
  { dimension: 'correctness' as const, score: 0.3 },
  { dimension: 'completeness' as const, score: 0.3 },
  { dimension: 'style' as const, score: 0.3 },
  { dimension: 'security' as const, score: 0.3 },
]

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GovernanceGateEngine', () => {
  let gate: GovernanceGateEngine

  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>).__governanceGate
    gate = GovernanceGateEngine.getInstance()
    // Default: no custom workspace rules → use DEFAULT_GATE_DIMENSIONS
    allMock.mockReturnValue([])
  })

  describe('evaluate', () => {
    it('returns passed=true when weighted score >= 0.625 (GATE_PASS_THRESHOLD)', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 1, changes: 1 })
      const result = gate.evaluate({ taskId: 1, gateType: 'pre_deploy', scores: allHighScores })
      expect(result.passed).toBe(true)
      expect(result.totalScore).toBeGreaterThanOrEqual(0.625)
    })

    it('returns passed=false when weighted score < 0.625', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 2, changes: 1 })
      const result = gate.evaluate({ taskId: 2, gateType: 'pre_commit', scores: allLowScores })
      expect(result.passed).toBe(false)
      expect(result.totalScore).toBeLessThan(0.625)
    })

    it('emits gate passed event when score passes', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 3, changes: 1 })
      gate.evaluate({ taskId: 3, gateType: 'pre_deploy', scores: allHighScores })
      expect(emitGatePassed).toHaveBeenCalledWith(3, 'pre_deploy', expect.any(Number))
      expect(emitGateFailed).not.toHaveBeenCalled()
    })

    it('emits gate failed event when score fails', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 4, changes: 1 })
      gate.evaluate({ taskId: 4, gateType: 'pre_commit', scores: allLowScores })
      expect(emitGateFailed).toHaveBeenCalledWith(4, 'pre_commit', expect.any(Number), 0.625)
      expect(emitGatePassed).not.toHaveBeenCalled()
    })

    it('overrideBy forces passed=true regardless of score', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 5, changes: 1 })
      const result = gate.evaluate({
        taskId: 5, gateType: 'pre_merge', scores: allLowScores, overrideBy: 'admin',
      })
      expect(result.passed).toBe(true)
      expect(result.overrideBy).toBe('admin')
    })

    it('returns the new ID from lastInsertRowid', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 99, changes: 1 })
      const result = gate.evaluate({ taskId: null, gateType: 'pre_release', scores: allHighScores })
      expect(result.id).toBe(99)
    })

    it('includes dimension scores in the result', () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 6, changes: 1 })
      const result = gate.evaluate({ taskId: 1, gateType: 'pre_deploy', scores: allHighScores })
      expect(result.scores).toHaveLength(4)
      expect(result.scores.every(s => s.score === 0.9)).toBe(true)
    })
  })

  describe('checkGate', () => {
    it('returns failed and emits reviewRequired when no evaluation exists', () => {
      getMock.mockReturnValueOnce(undefined)
      const outcome = gate.checkGate(1, 'pre_deploy', 1)
      expect(outcome).toBe('failed')
      expect(emitReviewRequired).toHaveBeenCalledWith(1, 'pre_deploy', expect.any(String))
    })

    it('returns passed when latest result has passed=1', () => {
      getMock.mockReturnValueOnce({ passed: 1, override_by: null })
      expect(gate.checkGate(1, 'pre_deploy', 1)).toBe('passed')
    })

    it('returns failed when latest result has passed=0', () => {
      getMock.mockReturnValueOnce({ passed: 0, override_by: null })
      expect(gate.checkGate(1, 'pre_deploy', 1)).toBe('failed')
    })

    it('returns override when override_by is set', () => {
      getMock.mockReturnValueOnce({ passed: 0, override_by: 'tony' })
      expect(gate.checkGate(1, 'pre_deploy', 1)).toBe('override')
    })
  })

  describe('listResults', () => {
    it('queries with workspaceId and limit', () => {
      allMock.mockReturnValueOnce([])
      gate.listResults(3, 10)
      expect(allMock).toHaveBeenCalledWith(3, 10)
    })

    it('uses defaults (workspaceId=1, limit=20)', () => {
      allMock.mockReturnValueOnce([])
      gate.listResults()
      expect(allMock).toHaveBeenCalledWith(1, 20)
    })
  })

  describe('upsertRule', () => {
    it('calls prepare with ON CONFLICT upsert SQL and runs with correct args', () => {
      gate.upsertRule({
        gateType: 'pre_deploy', dimension: 'security', weight: 0.4, threshold: 0.8, workspaceId: 1,
      })
      expect(prepMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'))
      expect(runMock).toHaveBeenCalledWith('pre_deploy', 'security', 0.4, 0.8, 1)
    })
  })
})
