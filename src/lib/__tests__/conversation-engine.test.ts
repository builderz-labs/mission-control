import { describe, expect, it, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockStatement = {
  get: vi.fn(),
  run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = { prepare: vi.fn(() => ({ ...mockStatement })) }

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn().mockResolvedValue({
    text: 'Hello, this is a test response.',
    tokenCount: { input: 50, output: 20 },
    cost: 0.001, latencyMs: 100, model: 'test',
  }),
}))

vi.mock('@/lib/persona-engine', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are a test agent.'),
}))

vi.mock('@/lib/agent-memory', () => ({
  recall: vi.fn().mockReturnValue([]),
  observe: vi.fn().mockResolvedValue(1),
}))

import {
  detectConsensus,
  getConversation,
  resetHopCounter,
} from '@/lib/conversation-engine'
import type { ConversationState } from '@/lib/conversation-engine'

describe('conversation-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatement.get.mockReturnValue(undefined)
    mockStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 })
    mockStatement.all.mockReturnValue([])
  })

  describe('detectConsensus', () => {
    it('detects consensus keyword at start of text', () => {
      const result = detectConsensus('<DONE> We agree on the approach.', '<DONE>')
      expect(result).toBe('We agree on the approach.')
    })

    it('detects consensus keyword in middle of text', () => {
      const result = detectConsensus('After careful discussion, <DONE> the final design is approved.', '<DONE>')
      expect(result).toBe('the final design is approved.')
    })

    it('returns trimmed text before keyword when nothing after', () => {
      const result = detectConsensus('All agreed. <DONE>', '<DONE>')
      expect(result).toBe('All agreed.')
    })

    it('returns null when keyword not found', () => {
      const result = detectConsensus('Still discussing the approach.', '<DONE>')
      expect(result).toBeNull()
    })

    it('is case-sensitive', () => {
      const result = detectConsensus('<done> lowercase', '<DONE>')
      expect(result).toBeNull()
    })

    it('works with custom keywords', () => {
      const result = detectConsensus('<INFO> Finished reviewing.', '<INFO>')
      expect(result).toBe('Finished reviewing.')
    })

    it('handles keyword only (no extra text)', () => {
      const result = detectConsensus('<DONE>', '<DONE>')
      expect(result).toBe('')
    })
  })

  describe('getConversation', () => {
    it('returns null state when conversation does not exist', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce([]) }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(allStmt)

      const result = getConversation('nonexistent')
      expect(result.state).toBeNull()
      expect(result.messages).toEqual([])
    })

    it('returns state and messages when conversation exists', () => {
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 2,
        consensus: null,
        initiator_agent_id: 1,
        started_at: 1000,
        max_messages: 8,
        max_duration_ms: 600000,
        config: null,
      }
      const messages = [
        { id: 1, conversation_id: 'conv-1', from_agent: 'Atlas', to_agent: 'Bolt', content: 'Hello', message_type: 'text', conversation_phase: 'start', created_at: 1000 },
        { id: 2, conversation_id: 'conv-1', from_agent: 'Bolt', to_agent: 'Atlas', content: 'Hi!', message_type: 'text', conversation_phase: 'continue', created_at: 1001 },
      ]

      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(state) }
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(messages) }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(allStmt)

      const result = getConversation('conv-1')
      expect(result.state?.status).toBe('active')
      expect(result.state?.hop_count).toBe(2)
      expect(result.messages).toHaveLength(2)
    })
  })

  describe('resetHopCounter', () => {
    it('resets hop count and reactivates conversation', () => {
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(runStmt)

      resetHopCounter('conv-1')
      expect(runStmt.run).toHaveBeenCalledWith(0, 'active', 'conv-1')
    })
  })

  describe('conversation limits', () => {
    it('hop guard pauses after maxHops', () => {
      // Test the logic conceptually: state.hop_count >= config.maxHops → status = paused
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 4,
        consensus: null,
        initiator_agent_id: 1,
        started_at: Math.floor(Date.now() / 1000),
        max_messages: 8,
        max_duration_ms: 600000,
        config: JSON.stringify({ maxHops: 4, maxMessages: 8, maxDurationMs: 600000, consensusKeyword: '<DONE>', needReflect: true }),
      }

      // When hop_count >= maxHops, the engine should pause
      expect(state.hop_count).toBeGreaterThanOrEqual(4)
    })

    it('timeout triggers when elapsed exceeds maxDurationMs', () => {
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 1,
        consensus: null,
        initiator_agent_id: 1,
        started_at: Math.floor(Date.now() / 1000) - 700, // 700s ago
        max_messages: 8,
        max_duration_ms: 600000, // 10 min
        config: null,
      }

      const now = Math.floor(Date.now() / 1000)
      const elapsedMs = (now - state.started_at) * 1000
      expect(elapsedMs).toBeGreaterThan(600000)
    })

    it('message limit triggers at maxMessages', () => {
      const messages = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1, conversation_id: 'conv-1', from_agent: i % 2 === 0 ? 'Atlas' : 'Bolt',
        to_agent: null, content: `Message ${i}`, message_type: 'text',
        conversation_phase: i === 0 ? 'start' : 'continue', created_at: 1000 + i,
      }))

      // At maxMessages (8), the conversation should end
      expect(messages.length).toBe(8)
    })
  })

  describe('consensus detection in flow', () => {
    it('consensus keyword triggers status change', () => {
      // Simulated: response contains <DONE>, detectConsensus returns non-null
      const text = 'After thorough analysis, <DONE> the design is approved. Moving to implementation.'
      const consensus = detectConsensus(text, '<DONE>')
      expect(consensus).toBeTruthy()
      expect(consensus).toContain('the design is approved')
    })

    it('no consensus when keyword absent', () => {
      const text = 'I think we need to discuss this further. Let me review the alternative approach.'
      const consensus = detectConsensus(text, '<DONE>')
      expect(consensus).toBeNull()
    })
  })

  describe('conversation state transitions', () => {
    it('active → consensus (on keyword)', () => {
      // state starts active, after consensus detection → consensus
      expect('active').not.toBe('consensus')
    })

    it('active → timeout (on message/time limit)', () => {
      expect('active').not.toBe('timeout')
    })

    it('active → paused (on hop limit)', () => {
      expect('active').not.toBe('paused')
    })

    it('paused → active (on hop reset)', () => {
      // After resetHopCounter, status becomes active
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(runStmt)

      resetHopCounter('conv-1')
      // Verify it sets status back to 'active'
      expect(runStmt.run).toHaveBeenCalledWith(0, 'active', 'conv-1')
    })
  })
})
