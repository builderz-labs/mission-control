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
  startConversation,
  continueConversation,
  leaveConversation,
  detectConsensus,
  getConversation,
  resetHopCounter,
} from '@/lib/conversation-engine'
import type { ConversationState } from '@/lib/conversation-engine'
import { complete } from '@/lib/llm/router'
import { observe } from '@/lib/agent-memory'
import { eventBus } from '@/lib/event-bus'

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

  describe('startConversation', () => {
    it('creates conversation state, generates opener, stores message, and updates hop count', async () => {
      const initiatorAgent = { id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: null, workspace_id: 1 }
      const targetAgent = { id: 2, name: 'Bolt', role: 'designer', soul_content: null, config: null, workspace_id: 1 }

      // 1st prepare -> getAgent(initiator): SELECT agents WHERE id=1
      const getInitiatorStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(initiatorAgent) }
      // 2nd prepare -> getAgent(target): SELECT agents WHERE id=2
      const getTargetStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(targetAgent) }
      // 3rd prepare -> INSERT conversation_state
      const insertStateStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }) }
      // 4th prepare -> INSERT message (storeMessage)
      const insertMessageStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }) }
      // 5th prepare -> UPDATE conversation_state (updateState hop_count=1)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getInitiatorStmt)   // getAgent(initiatorId)
        .mockReturnValueOnce(getTargetStmt)       // getAgent(targetId)
        .mockReturnValueOnce(insertStateStmt)     // INSERT conversation_state
        .mockReturnValueOnce(insertMessageStmt)   // INSERT message
        .mockReturnValueOnce(updateStateStmt)     // UPDATE conversation_state

      const conversationId = await startConversation(1, 2, 'testing topic', 1)

      // Returns a UUID string
      expect(conversationId).toBeDefined()
      expect(typeof conversationId).toBe('string')
      expect(conversationId.length).toBeGreaterThan(0)

      // Verify conversation_state INSERT was called
      expect(insertStateStmt.run).toHaveBeenCalledWith(
        conversationId, 1, expect.any(Number), 8, 600000, expect.any(String),
      )

      // Verify message INSERT was called (storeMessage)
      expect(insertMessageStmt.run).toHaveBeenCalledWith(
        conversationId, 'Atlas', 'Bolt',
        'Hello, this is a test response.', // trimmed LLM response
        'start',
      )

      // Verify hop_count updated to 1
      expect(updateStateStmt.run).toHaveBeenCalledWith(1, conversationId)

      // Verify LLM complete was called
      expect(complete).toHaveBeenCalledOnce()

      // Verify eventBus broadcast for the message
      expect(eventBus.broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({
        conversation_id: conversationId,
        from_agent: 'Atlas',
        to_agent: 'Bolt',
        phase: 'start',
      }))
    })

    it('throws when initiator agent not found', async () => {
      // 1st prepare -> getAgent returns null
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      mockDb.prepare.mockReturnValueOnce(getStmt)

      await expect(startConversation(999, 2, 'test', 1)).rejects.toThrow('Initiator agent 999 not found')
    })

    it('throws when target agent not found', async () => {
      const initiator = { id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: null, workspace_id: 1 }
      const getInitiatorStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(initiator) }
      const getTargetStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      mockDb.prepare
        .mockReturnValueOnce(getInitiatorStmt)
        .mockReturnValueOnce(getTargetStmt)

      await expect(startConversation(1, 999, 'test', 1)).rejects.toThrow('Target agent 999 not found')
    })
  })

  describe('continueConversation', () => {
    const activeState: ConversationState = {
      conversation_id: 'conv-1',
      status: 'active',
      hop_count: 1,
      consensus: null,
      initiator_agent_id: 1,
      started_at: Math.floor(Date.now() / 1000),
      max_messages: 8,
      max_duration_ms: 600000,
      config: JSON.stringify({ maxMessages: 8, maxDurationMs: 600000, consensusKeyword: '<DONE>', maxHops: 4, needReflect: true }),
    }

    const responderAgent = { id: 2, name: 'Bolt', role: 'designer', soul_content: null, config: null, workspace_id: 1 }

    const existingMessages = [
      { id: 1, conversation_id: 'conv-1', from_agent: 'Atlas', to_agent: 'Bolt', content: 'Hello there!', message_type: 'text', conversation_phase: 'start', created_at: 1000 },
    ]

    it('generates response, stores message, increments hop, and returns continues=true', async () => {
      // 1st prepare -> getState
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(activeState) }
      // 2nd prepare -> getConversationMessages
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(existingMessages) }
      // 3rd prepare -> getAgent(responder)
      const getResponderStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(responderAgent) }
      // 4th prepare -> INSERT message (storeMessage)
      const insertMessageStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(2), changes: 1 }) }
      // 5th prepare -> UPDATE conversation_state (updateState hop_count)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(getResponderStmt)
        .mockReturnValueOnce(insertMessageStmt)
        .mockReturnValueOnce(updateStateStmt)

      const result = await continueConversation('conv-1', 2, 1)

      expect(result.continues).toBe(true)
      expect(result.reason).toBeUndefined()

      // Verify message was stored
      expect(insertMessageStmt.run).toHaveBeenCalledWith(
        'conv-1', 'Bolt', 'Atlas',
        'Hello, this is a test response.',
        'continue',
      )

      // Verify hop_count was incremented (from 1 to 2)
      expect(updateStateStmt.run).toHaveBeenCalledWith(2, 'conv-1')

      // Verify LLM was called with conversation history
      expect(complete).toHaveBeenCalledOnce()
    })

    it('returns continues=false with reason containing "limit" when message limit reached', async () => {
      // 8 messages already exist (maxMessages = 8)
      const fullMessages = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1, conversation_id: 'conv-1',
        from_agent: i % 2 === 0 ? 'Atlas' : 'Bolt',
        to_agent: i % 2 === 0 ? 'Bolt' : 'Atlas',
        content: `Message ${i}`, message_type: 'text',
        conversation_phase: i === 0 ? 'start' : 'continue',
        created_at: 1000 + i,
      }))

      // 1st prepare -> getState
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(activeState) }
      // 2nd prepare -> getConversationMessages (returns 8 messages = at limit)
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(fullMessages) }
      // 3rd prepare -> UPDATE conversation_state (status -> timeout)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(updateStateStmt)

      const result = await continueConversation('conv-1', 2, 1)

      expect(result.continues).toBe(false)
      expect(result.reason).toContain('limit')

      // LLM should NOT have been called
      expect(complete).not.toHaveBeenCalled()

      // State should have been updated to 'timeout'
      expect(updateStateStmt.run).toHaveBeenCalledWith('timeout', 'conv-1')
    })

    it('returns continues=false with reason containing "Hop" when hop limit reached', async () => {
      const hopLimitState: ConversationState = {
        ...activeState,
        hop_count: 4, // maxHops = 4
      }

      // 1st prepare -> getState (hop_count at limit)
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(hopLimitState) }
      // 2nd prepare -> getConversationMessages (few messages, under limit)
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(existingMessages) }
      // 3rd prepare -> UPDATE conversation_state (status -> paused)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(updateStateStmt)

      const result = await continueConversation('conv-1', 2, 1)

      expect(result.continues).toBe(false)
      expect(result.reason).toContain('Hop')

      // State should be updated to 'paused'
      expect(updateStateStmt.run).toHaveBeenCalledWith('paused', 'conv-1')
    })

    it('returns continues=false with reason "Consensus reached" when LLM response contains <DONE>', async () => {
      // Mock LLM to return response with consensus keyword
      vi.mocked(complete).mockResolvedValueOnce({
        text: 'I agree with your approach. <DONE> The design is finalized.',
        tokenCount: { input: 50, output: 30 },
        cost: 0.001, latencyMs: 100, model: 'test',
      })

      // 1st prepare -> getState
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(activeState) }
      // 2nd prepare -> getConversationMessages
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(existingMessages) }
      // 3rd prepare -> getAgent(responder)
      const getResponderStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(responderAgent) }
      // 4th prepare -> INSERT message (storeMessage for the consensus response)
      const insertMessageStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(3), changes: 1 }) }
      // 5th prepare -> UPDATE conversation_state (status -> consensus, consensus text, hop_count)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(getResponderStmt)
        .mockReturnValueOnce(insertMessageStmt)
        .mockReturnValueOnce(updateStateStmt)

      const result = await continueConversation('conv-1', 2, 1)

      expect(result.continues).toBe(false)
      expect(result.reason).toBe('Consensus reached')

      // Verify the message was still stored
      expect(insertMessageStmt.run).toHaveBeenCalled()

      // Verify state was updated with consensus status
      expect(updateStateStmt.run).toHaveBeenCalledWith(
        'consensus',
        'The design is finalized.',
        2, // hop_count incremented from 1 to 2
        'conv-1',
      )
    })

    it('returns continues=false when conversation status is not active', async () => {
      const completedState: ConversationState = {
        ...activeState,
        status: 'completed',
      }

      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(completedState) }
      mockDb.prepare.mockReturnValueOnce(getStateStmt)

      const result = await continueConversation('conv-1', 2, 1)

      expect(result.continues).toBe(false)
      expect(result.reason).toContain('completed')
    })

    it('throws when conversation not found', async () => {
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      mockDb.prepare.mockReturnValueOnce(getStateStmt)

      await expect(continueConversation('nonexistent', 2, 1)).rejects.toThrow('Conversation nonexistent not found')
    })

    it('throws when responder agent not found', async () => {
      // 1st prepare -> getState
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(activeState) }
      // 2nd prepare -> getConversationMessages
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(existingMessages) }
      // 3rd prepare -> getAgent returns null
      const getResponderStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(getResponderStmt)

      await expect(continueConversation('conv-1', 999, 1)).rejects.toThrow('Responder agent 999 not found')
    })
  })

  describe('leaveConversation', () => {
    it('generates farewell, stores memory summary, and marks conversation completed', async () => {
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 3,
        consensus: null,
        initiator_agent_id: 1,
        started_at: Math.floor(Date.now() / 1000) - 60,
        max_messages: 8,
        max_duration_ms: 600000,
        config: null,
      }
      const agent = { id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: null, workspace_id: 1 }
      const messages = [
        { id: 1, conversation_id: 'conv-1', from_agent: 'Atlas', to_agent: 'Bolt', content: 'Hello', message_type: 'text', conversation_phase: 'start', created_at: 1000 },
        { id: 2, conversation_id: 'conv-1', from_agent: 'Bolt', to_agent: 'Atlas', content: 'Hi back!', message_type: 'text', conversation_phase: 'continue', created_at: 1001 },
      ]

      // Mock LLM: first call = farewell, second call = summary
      vi.mocked(complete)
        .mockResolvedValueOnce({
          text: 'Goodbye, it was great talking!',
          tokenCount: { input: 50, output: 10 },
          cost: 0.001, latencyMs: 80, model: 'test',
        })
        .mockResolvedValueOnce({
          text: 'Had a productive conversation about the project design.',
          tokenCount: { input: 60, output: 15 },
          cost: 0.001, latencyMs: 90, model: 'test',
        })

      // 1st prepare -> getState
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(state) }
      // 2nd prepare -> getAgent
      const getAgentStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(agent) }
      // 3rd prepare -> getConversationMessages
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(messages) }
      // 4th prepare -> INSERT farewell message (storeMessage)
      const insertFarewellStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(3), changes: 1 }) }
      // 5th prepare -> UPDATE conversation_state (status -> completed)
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getAgentStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(insertFarewellStmt)
        .mockReturnValueOnce(updateStateStmt)

      await leaveConversation(1, 'conv-1', 1)

      // Verify farewell message was stored
      expect(insertFarewellStmt.run).toHaveBeenCalledWith(
        'conv-1', 'Atlas', null,
        'Goodbye, it was great talking!',
        'leave',
      )

      // Verify eventBus broadcast for farewell
      expect(eventBus.broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({
        conversation_id: 'conv-1',
        from_agent: 'Atlas',
        phase: 'leave',
      }))

      // Verify observe() was called with the summary text
      expect(observe).toHaveBeenCalledWith(
        1,
        'Had a productive conversation about the project design.',
        1,
      )

      // Verify state was updated to 'completed'
      expect(updateStateStmt.run).toHaveBeenCalledWith('completed', 'conv-1')

      // Verify LLM was called twice (farewell + summary)
      expect(complete).toHaveBeenCalledTimes(2)
    })

    it('throws when conversation not found', async () => {
      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      mockDb.prepare.mockReturnValueOnce(getStateStmt)

      await expect(leaveConversation(1, 'nonexistent', 1)).rejects.toThrow('Conversation nonexistent not found')
    })

    it('throws when agent not found', async () => {
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 1,
        consensus: null,
        initiator_agent_id: 1,
        started_at: Math.floor(Date.now() / 1000),
        max_messages: 8,
        max_duration_ms: 600000,
        config: null,
      }

      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(state) }
      const getAgentStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(null) }
      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getAgentStmt)

      await expect(leaveConversation(999, 'conv-1', 1)).rejects.toThrow('Agent 999 not found')
    })

    it('still completes conversation even if observe fails', async () => {
      const state: ConversationState = {
        conversation_id: 'conv-1',
        status: 'active',
        hop_count: 2,
        consensus: null,
        initiator_agent_id: 1,
        started_at: Math.floor(Date.now() / 1000) - 30,
        max_messages: 8,
        max_duration_ms: 600000,
        config: null,
      }
      const agent = { id: 1, name: 'Atlas', role: 'engineer', soul_content: null, config: null, workspace_id: 1 }
      const messages = [
        { id: 1, conversation_id: 'conv-1', from_agent: 'Atlas', to_agent: 'Bolt', content: 'Hello', message_type: 'text', conversation_phase: 'start', created_at: 1000 },
      ]

      // farewell LLM response
      vi.mocked(complete)
        .mockResolvedValueOnce({
          text: 'Goodbye!',
          tokenCount: { input: 50, output: 10 },
          cost: 0.001, latencyMs: 80, model: 'test',
        })
        .mockResolvedValueOnce({
          text: 'Summary text.',
          tokenCount: { input: 60, output: 15 },
          cost: 0.001, latencyMs: 90, model: 'test',
        })

      // Make observe() reject
      vi.mocked(observe).mockRejectedValueOnce(new Error('Memory system failed'))

      const getStateStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(state) }
      const getAgentStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce(agent) }
      const getMessagesStmt = { ...mockStatement, all: vi.fn().mockReturnValueOnce(messages) }
      const insertFarewellStmt = { ...mockStatement, run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(2), changes: 1 }) }
      const updateStateStmt = { ...mockStatement, run: vi.fn() }

      mockDb.prepare
        .mockReturnValueOnce(getStateStmt)
        .mockReturnValueOnce(getAgentStmt)
        .mockReturnValueOnce(getMessagesStmt)
        .mockReturnValueOnce(insertFarewellStmt)
        .mockReturnValueOnce(updateStateStmt)

      // Should NOT throw despite observe failure (caught internally)
      await leaveConversation(1, 'conv-1', 1)

      // State should still be updated to 'completed'
      expect(updateStateStmt.run).toHaveBeenCalledWith('completed', 'conv-1')
    })
  })
})
