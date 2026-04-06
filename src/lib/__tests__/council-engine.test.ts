/**
 * Tests for src/lib/council/engine.ts
 * WHY: Validates DB interactions, transaction wrapping, workspace scoping,
 * round cap, and event emission for the Council Deliberation Engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const runMock = vi.fn((..._a: unknown[]) => ({ lastInsertRowid: 1, changes: 1 }))
const getMock = vi.fn<() => unknown>()
const allMock = vi.fn<() => unknown[]>(() => [])
const prepMock = vi.fn(() => ({ run: runMock, get: getMock, all: allMock }))
// WHY: transaction(fn)() must execute fn() — returning fn lets the calling ()
// invoke it directly, exercising the real body inside the mock transaction
const txMock = vi.fn((fn: () => unknown) => fn)

vi.mock('../db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepMock, transaction: txMock })) }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../autonomous-events', () => ({
  emitDeliberationStarted: vi.fn(),
  emitDeliberationCompleted: vi.fn(),
  emitVoteCast: vi.fn(),
  emitSynthesisReached: vi.fn(),
}))

import { CouncilDeliberationEngine } from '../council/engine'
import {
  emitDeliberationStarted,
  emitVoteCast,
  emitSynthesisReached,
  emitDeliberationCompleted,
} from '../autonomous-events'
import { logger } from '../logger'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseRow = {
  id: 1, topic: 'Should we expand?', context: '{"budget":1000}',
  workspace_id: 1, status: 'open', round: 1,
  synthesis: null, started_at: 1000, completed_at: null,
}

function makeVoteRow(id: number, stance: string, confidence = 0.8) {
  return { id, deliberation_id: 1, agent_id: `agent-${id}`, round: 1,
    position: 'agree', stance, confidence, workspace_id: 1, created_at: 1000 }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CouncilDeliberationEngine', () => {
  let engine: CouncilDeliberationEngine

  beforeEach(() => {
    vi.clearAllMocks()
    // WHY: wipe singleton so each test starts with a clean instance
    delete (globalThis as Record<string, unknown>).__councilEngine
    engine = CouncilDeliberationEngine.getInstance()
  })

  describe('startDeliberation', () => {
    it('inserts a row and returns the new ID', async () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 7, changes: 1 })
      const id = await engine.startDeliberation('Expand?', { a: 1 }, 2)
      expect(id).toBe(7)
      expect(runMock).toHaveBeenCalledWith('Expand?', JSON.stringify({ a: 1 }), 2)
    })

    it('emits deliberation started with correct args', async () => {
      runMock.mockReturnValueOnce({ lastInsertRowid: 3, changes: 1 })
      await engine.startDeliberation('Topic', {}, 5)
      expect(emitDeliberationStarted).toHaveBeenCalledWith(3, 'Topic', 5)
    })
  })

  describe('submitVote', () => {
    it('inserts the vote row with all fields', async () => {
      await engine.submitVote({
        deliberationId: 1, agentId: 'cso', round: 2,
        position: 'We should', stance: 'support', confidence: 0.9, workspaceId: 3,
      })
      expect(runMock).toHaveBeenCalledWith(1, 'cso', 2, 'We should', 'support', 0.9, 3)
    })

    it('emits vote cast event', async () => {
      await engine.submitVote({
        deliberationId: 1, agentId: 'cfo', round: 1,
        position: 'No', stance: 'oppose', confidence: 0.7, workspaceId: 1,
      })
      expect(emitVoteCast).toHaveBeenCalledWith(1, 'cfo', 1, 'oppose')
    })
  })

  describe('advanceRound', () => {
    it('wraps logic in a transaction', async () => {
      getMock.mockReturnValueOnce(baseRow)
      allMock.mockReturnValueOnce([])
      await engine.advanceRound(1)
      expect(txMock).toHaveBeenCalledOnce()
    })

    it('returns continue and applies round cap when votes below threshold', async () => {
      getMock.mockReturnValueOnce(baseRow)
      allMock.mockReturnValueOnce([])  // 0 votes < MIN_VOTES_TO_EVALUATE(3)
      const result = await engine.advanceRound(1)
      expect(result).toBe('continue')
      // UPDATE ... SET round = round + 1 WHERE id = ? AND round < MAX_ROUNDS(10)
      expect(runMock).toHaveBeenCalledWith(1, 10)
    })

    it('returns synthesize when consensus threshold is met', async () => {
      getMock.mockReturnValueOnce(baseRow)
      allMock.mockReturnValueOnce([
        makeVoteRow(1, 'support'), makeVoteRow(2, 'support'),
        makeVoteRow(3, 'support'), makeVoteRow(4, 'support'),
      ])
      const result = await engine.advanceRound(1)
      expect(result).toBe('synthesize')
    })

    it('returns deadlock when round >= 3 and no consensus', async () => {
      getMock.mockReturnValueOnce({ ...baseRow, round: 3 })
      allMock.mockReturnValueOnce([
        makeVoteRow(1, 'support'), makeVoteRow(2, 'oppose'), makeVoteRow(3, 'neutral'),
      ])
      const result = await engine.advanceRound(1)
      expect(result).toBe('deadlock')
    })

    it('throws when deliberation is not found', async () => {
      getMock.mockReturnValueOnce(undefined)
      await expect(engine.advanceRound(999)).rejects.toThrow('Deliberation 999 not found')
    })
  })

  describe('synthesize', () => {
    it('wraps vote read + status update in a transaction', async () => {
      allMock.mockReturnValueOnce([])
      await engine.synthesize(1, 1)
      expect(txMock).toHaveBeenCalledOnce()
    })

    it('passes workspaceId to the vote query to scope to caller workspace', async () => {
      allMock.mockReturnValueOnce([])
      await engine.synthesize(5, 7)
      // first all() call args: (deliberationId, workspaceId)
      expect(allMock).toHaveBeenCalledWith(5, 7)
    })

    it('returns valid synthesis JSON with totalVotes count', async () => {
      allMock.mockReturnValueOnce([
        makeVoteRow(1, 'support'), makeVoteRow(2, 'support'), makeVoteRow(3, 'oppose'),
      ])
      const result = await engine.synthesize(1, 1)
      const parsed = JSON.parse(result)
      expect(parsed.totalVotes).toBe(3)
      expect(parsed.supportingAgents).toHaveLength(2)
      expect(parsed.opposingAgents).toHaveLength(1)
    })

    it('emits both synthesis and completion events after transaction', async () => {
      allMock.mockReturnValueOnce([
        makeVoteRow(1, 'support'), makeVoteRow(2, 'support'), makeVoteRow(3, 'support'),
      ])
      await engine.synthesize(2, 9)
      expect(emitSynthesisReached).toHaveBeenCalledWith(2, expect.any(Number))
      expect(emitDeliberationCompleted).toHaveBeenCalledWith(2, expect.any(String), 9)
    })
  })

  describe('getDeliberation', () => {
    it('returns null when no row found', () => {
      getMock.mockReturnValueOnce(undefined)
      expect(engine.getDeliberation(999, 1)).toBeNull()
    })

    it('returns deliberation with votes when found', () => {
      getMock.mockReturnValueOnce(baseRow)
      allMock.mockReturnValueOnce([makeVoteRow(1, 'support')])
      const result = engine.getDeliberation(1, 1)
      expect(result).not.toBeNull()
      expect(result!.topic).toBe('Should we expand?')
      expect(result!.votes).toHaveLength(1)
    })

    it('falls back to empty context and warns when context JSON is corrupted', () => {
      getMock.mockReturnValueOnce({ ...baseRow, context: 'NOT_JSON' })
      allMock.mockReturnValueOnce([])
      const result = engine.getDeliberation(1, 1)
      expect(result!.context).toEqual({})
      expect(vi.mocked(logger.warn)).toHaveBeenCalled()
    })
  })

  describe('listDeliberations', () => {
    it('uses the default limit of 20', () => {
      allMock.mockReturnValueOnce([])
      engine.listDeliberations(1)
      expect(allMock).toHaveBeenCalledWith(1, 20)
    })

    it('caps the caller-supplied limit at 100 to prevent DoS', () => {
      allMock.mockReturnValueOnce([])
      engine.listDeliberations(1, 9999)
      expect(allMock).toHaveBeenCalledWith(1, 100)
    })

    it('respects caller-supplied limit when within range', () => {
      allMock.mockReturnValueOnce([])
      engine.listDeliberations(1, 50)
      expect(allMock).toHaveBeenCalledWith(1, 50)
    })
  })
})
