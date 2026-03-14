import { describe, expect, it, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockStatement = {
  get: vi.fn(),
  run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = {
  prepare: vi.fn(() => ({ ...mockStatement })),
  exec: vi.fn(),
  transaction: vi.fn((fn: Function) => fn),
}

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  },
}))

vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn().mockResolvedValue({
    text: '{"importance": 7}',
    tokenCount: { input: 50, output: 20 },
    cost: 0.001,
    latencyMs: 100,
    model: 'claude-haiku-4-5',
  }),
}))

vi.mock('@/lib/llm/output-repair', () => ({
  repairAndParse: vi.fn().mockReturnValue({ importance: 7 }),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

import {
  observeSync,
  recall,
  recordRelationship,
  getTimeline,
  getMemoryStats,
  textHash,
} from '@/lib/agent-memory'
import type { AgentMemory } from '@/lib/agent-memory'

describe('agent-memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mockStatement to fresh defaults
    mockStatement.get.mockReturnValue(undefined)
    mockStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 })
    mockStatement.all.mockReturnValue([])
  })

  describe('observeSync', () => {
    it('inserts an observation with given importance', () => {
      const stmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(42) }) }
      mockDb.prepare.mockReturnValueOnce(stmt)

      const id = observeSync(1, 'Agent completed task #5', 7, 1)
      expect(id).toBe(42)
      expect(stmt.run).toHaveBeenCalledWith(
        1,                      // agentId
        'Agent completed task #5', // description
        7,                      // importance
        expect.any(Number),     // now
        null,                   // relatedAgentId
        1,                      // workspaceId
        expect.any(Number),     // created_at
      )
    })

    it('stores related agent ID when provided', () => {
      const stmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(10) }) }
      mockDb.prepare.mockReturnValueOnce(stmt)

      observeSync(1, 'Had conversation with Agent B', 5, 1, 2)
      expect(stmt.run).toHaveBeenCalledWith(
        1, 'Had conversation with Agent B', 5,
        expect.any(Number), 2, 1, expect.any(Number),
      )
    })
  })

  describe('recall', () => {
    it('returns empty array when no memories exist', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValue([]) }
      mockDb.prepare.mockReturnValue(allStmt)

      const results = recall(1, 'test query', 1, 5)
      expect(results).toEqual([])
    })

    it('scores memories with composite formula', () => {
      const now = Math.floor(Date.now() / 1000)
      const memories: AgentMemory[] = [
        {
          id: 1, agent_id: 1, type: 'observation',
          description: 'completed the critical deployment task',
          importance: 9, last_access: now, related_agent_id: null,
          source_memory_ids: null, workspace_id: 1, created_at: now,
        },
        {
          id: 2, agent_id: 1, type: 'observation',
          description: 'routine status check performed',
          importance: 2, last_access: now - 86400, related_agent_id: null,
          source_memory_ids: null, workspace_id: 1, created_at: now - 86400,
        },
      ]

      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(memories) }
      const updateStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce(allStmt)   // fetch
        .mockReturnValueOnce(updateStmt) // update last_access

      const results = recall(1, 'deployment task', 1, 5)
      expect(results.length).toBe(2)
      // The deployment task memory should score higher (matches query + higher importance + more recent)
      expect(results[0].id).toBe(1)
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })

    it('limits results to topK', () => {
      const now = Math.floor(Date.now() / 1000)
      const memories: AgentMemory[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, agent_id: 1, type: 'observation' as const,
        description: `memory number ${i + 1} about test topic`,
        importance: i, last_access: now - i * 3600,
        related_agent_id: null, source_memory_ids: null,
        workspace_id: 1, created_at: now - i * 3600,
      }))

      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(memories) }
      const updateStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce(allStmt)
        .mockReturnValueOnce(updateStmt)

      const results = recall(1, 'test topic', 1, 3)
      expect(results.length).toBe(3)
    })

    it('updates last_access on returned memories', () => {
      const now = Math.floor(Date.now() / 1000)
      const memories: AgentMemory[] = [{
        id: 5, agent_id: 1, type: 'observation',
        description: 'found a critical bug in production',
        importance: 8, last_access: now - 7200,
        related_agent_id: null, source_memory_ids: null,
        workspace_id: 1, created_at: now - 7200,
      }]

      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(memories) }
      const updateStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce(allStmt)
        .mockReturnValueOnce(updateStmt)

      recall(1, 'critical bug', 1, 5)
      expect(updateStmt.run).toHaveBeenCalled()
    })

    it('handles query with no meaningful search terms', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      const results = recall(1, 'is a', 1, 5) // words too short
      expect(results).toEqual([])
    })
  })

  describe('recordRelationship', () => {
    it('creates new relationship when none exists', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(undefined) }
      const insertStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(20) }) }
      mockDb.prepare
        .mockReturnValueOnce(getStmt)    // check existing
        .mockReturnValueOnce(insertStmt) // insert

      const id = recordRelationship(1, 2, 'Collaborates on project X', 7, 1)
      expect(id).toBe(20)
    })

    it('updates existing relationship', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ id: 15 }) }
      const updateStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce(getStmt)
        .mockReturnValueOnce(updateStmt)

      const id = recordRelationship(1, 2, 'Updated collaboration', 8, 1)
      expect(id).toBe(15)
      expect(updateStmt.run).toHaveBeenCalled()
    })
  })

  describe('getTimeline', () => {
    it('queries without type filter by default', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      getTimeline(1, 1)
      expect(allStmt.all).toHaveBeenCalledWith(1, 1, 50, 0)
    })

    it('queries with type filter when specified', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      getTimeline(1, 1, { type: 'reflection' })
      expect(allStmt.all).toHaveBeenCalledWith(1, 1, 'reflection', 50, 0)
    })

    it('respects limit and offset options', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      getTimeline(1, 1, { limit: 10, offset: 20 })
      expect(allStmt.all).toHaveBeenCalledWith(1, 1, 10, 20)
    })
  })

  describe('getMemoryStats', () => {
    it('returns aggregate stats', () => {
      const getStmt = {
        ...mockStatement,
        get: vi.fn().mockReturnValueOnce({
          total: 15,
          observations: 10,
          reflections: 3,
          relationships: 2,
          avgImportance: 5.5,
        }),
      }
      mockDb.prepare.mockReturnValueOnce(getStmt)

      const stats = getMemoryStats(1, 1)
      expect(stats.total).toBe(15)
      expect(stats.observations).toBe(10)
      expect(stats.reflections).toBe(3)
      expect(stats.relationships).toBe(2)
      expect(stats.avgImportance).toBe(5.5)
    })
  })

  describe('textHash', () => {
    it('produces consistent hashes', () => {
      const hash1 = textHash('hello world')
      const hash2 = textHash('hello world')
      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different inputs', () => {
      const hash1 = textHash('hello')
      const hash2 = textHash('world')
      expect(hash1).not.toBe(hash2)
    })

    it('returns a 16-char hex string', () => {
      const hash = textHash('test')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  describe('recency decay', () => {
    it('recent memories score higher than old ones (all else equal)', () => {
      const now = Math.floor(Date.now() / 1000)
      const memories: AgentMemory[] = [
        {
          id: 1, agent_id: 1, type: 'observation',
          description: 'working on project alpha features',
          importance: 5, last_access: now,
          related_agent_id: null, source_memory_ids: null,
          workspace_id: 1, created_at: now,
        },
        {
          id: 2, agent_id: 1, type: 'observation',
          description: 'working on project alpha tasks',
          importance: 5, last_access: now - 72 * 3600, // 3 days ago
          related_agent_id: null, source_memory_ids: null,
          workspace_id: 1, created_at: now - 72 * 3600,
        },
      ]

      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(memories) }
      const updateStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce(allStmt)
        .mockReturnValueOnce(updateStmt)

      const results = recall(1, 'project alpha', 1, 5)
      expect(results.length).toBe(2)
      expect(results[0].id).toBe(1) // recent one first
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })
})
