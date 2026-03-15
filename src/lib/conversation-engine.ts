/**
 * Conversation Engine — AI Town lifecycle + ChatDev consensus + Agentchattr loop guard.
 *
 * Three-phase conversations (AI Town pattern):
 *   1. Start: build prompts, recall memories, generate opener
 *   2. Continue: load history, check limits, generate response, detect consensus
 *   3. Leave: farewell, summarize, store memory
 *
 * Safety:
 *   - Hop guard: max N agent-to-agent messages before auto-pause (Agentchattr)
 *   - Consensus detection: keyword match ends conversation (ChatDev)
 *   - Time/message limits: configurable bounds
 *
 * Depends on Phase 0 (LLM), Phase 1 (memory), Phase 2 (persona).
 */

import { randomUUID } from 'crypto'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'
import { eventBus } from '@/lib/event-bus'
import { buildSystemPrompt } from '@/lib/persona-engine'
import { observe, recall } from '@/lib/agent-memory'

// --- Types ---

export interface ConversationConfig {
  maxMessages: number
  maxDurationMs: number
  consensusKeyword: string
  maxHops: number
  needReflect: boolean
}

export interface ConversationState {
  conversation_id: string
  status: 'active' | 'consensus' | 'timeout' | 'paused' | 'completed'
  hop_count: number
  consensus: string | null
  initiator_agent_id: number | null
  started_at: number
  max_messages: number
  max_duration_ms: number
  config: string | null
}

interface MessageRow {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string | null
  content: string
  message_type: string
  conversation_phase: string | null
  created_at: number
}

interface AgentRow {
  id: number
  name: string
  role: string
  soul_content: string | null
  config: string | null
  workspace_id: number
}

export type BreakCondition =
  | { type: 'keyword'; keyword: string }
  | { type: 'flag'; field: string; value: boolean }
  | { type: 'empty'; field: string }

export interface DebateConfig extends ConversationConfig {
  participants: number[]
  maxCycles: number
  breakCondition: BreakCondition
}

// --- Defaults ---

const DEFAULT_CONFIG: ConversationConfig = {
  maxMessages: 8,
  maxDurationMs: 600000, // 10 minutes
  consensusKeyword: '<DONE>',
  maxHops: 4,
  needReflect: true,
}

// --- Helpers ---

function getAgent(db: ReturnType<typeof getDatabase>, agentId: number, workspaceId: number): AgentRow | null {
  return db.prepare(
    'SELECT id, name, role, soul_content, config, workspace_id FROM agents WHERE id = ? AND workspace_id = ?'
  ).get(agentId, workspaceId) as AgentRow | null
}

function getConversationMessages(db: ReturnType<typeof getDatabase>, conversationId: string): MessageRow[] {
  return db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MessageRow[]
}

function storeMessage(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  fromAgent: string,
  toAgent: string | null,
  content: string,
  phase: 'start' | 'continue' | 'leave',
): number {
  const result = db.prepare(
    `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, conversation_phase)
     VALUES (?, ?, ?, ?, 'text', ?)`
  ).run(conversationId, fromAgent, toAgent, content, phase)

  eventBus.broadcast('chat.message', {
    conversation_id: conversationId,
    from_agent: fromAgent,
    to_agent: toAgent,
    content,
    phase,
  })

  return Number(result.lastInsertRowid)
}

function getState(db: ReturnType<typeof getDatabase>, conversationId: string): ConversationState | null {
  return db.prepare(
    'SELECT * FROM conversation_state WHERE conversation_id = ?'
  ).get(conversationId) as ConversationState | null
}

function updateState(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  updates: Partial<ConversationState>,
): void {
  const fields = Object.entries(updates)
    .filter(([k]) => k !== 'conversation_id')
    .map(([k]) => `${k} = ?`)
  const values = Object.entries(updates)
    .filter(([k]) => k !== 'conversation_id')
    .map(([, v]) => v)

  if (fields.length === 0) return

  db.prepare(
    `UPDATE conversation_state SET ${fields.join(', ')} WHERE conversation_id = ?`
  ).run(...values, conversationId)
}

/**
 * Check if a response contains the consensus keyword.
 * Returns the conclusion text after the keyword, or null.
 */
export function detectConsensus(text: string, keyword: string): string | null {
  const idx = text.indexOf(keyword)
  if (idx === -1) return null
  return text.slice(idx + keyword.length).trim() || text.slice(0, idx).trim()
}

// --- Core Operations ---

/**
 * Start a new LLM-driven conversation between two agents.
 */
export async function startConversation(
  initiatorId: number,
  targetId: number,
  topic: string,
  workspaceId: number = 1,
  configOverrides?: Partial<ConversationConfig>,
): Promise<string> {
  const db = getDatabase()
  const config = { ...DEFAULT_CONFIG, ...configOverrides }

  const initiator = getAgent(db, initiatorId, workspaceId)
  const target = getAgent(db, targetId, workspaceId)
  if (!initiator) throw new Error(`Initiator agent ${initiatorId} not found`)
  if (!target) throw new Error(`Target agent ${targetId} not found`)

  const conversationId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Create conversation state
  db.prepare(
    `INSERT INTO conversation_state (conversation_id, status, hop_count, initiator_agent_id, started_at, max_messages, max_duration_ms, config)
     VALUES (?, 'active', 0, ?, ?, ?, ?, ?)`
  ).run(conversationId, initiatorId, now, config.maxMessages, config.maxDurationMs, JSON.stringify(config))

  // Build system prompt for initiator
  const initiatorConfig = initiator.config ? JSON.parse(initiator.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: initiator.name,
    role: initiator.role,
    soul_content: initiator.soul_content,
    config: initiatorConfig,
  })

  // Recall relevant memories for context
  let memoryContext = ''
  try {
    const memories = recall(initiatorId, topic, workspaceId, 3)
    if (memories.length > 0) {
      memoryContext = '\n\nRelevant memories:\n' + memories.map((m) => `- ${m.description}`).join('\n')
    }
  } catch {
    // Memory system may not be available yet
  }

  // Generate opener
  const response = await complete(
    [
      { role: 'system', content: systemPrompt + memoryContext },
      {
        role: 'user',
        content: `You are starting a conversation with ${target.name} (${target.role}) about: ${topic}\n\nGenerate a brief opening message (max 200 characters). Be natural and in-character.`,
      },
    ],
    { agentId: initiatorId, workspaceId, taskType: 'conversation' },
  )

  // Store the opening message
  storeMessage(db, conversationId, initiator.name, target.name, response.text.trim(), 'start')

  // Update hop count
  updateState(db, conversationId, { hop_count: 1 })

  logger.info({ conversationId, initiator: initiator.name, target: target.name, topic }, 'Conversation started')

  return conversationId
}

/**
 * Continue a conversation — the specified agent generates a response.
 * Returns true if conversation should continue, false if it ended.
 */
export async function continueConversation(
  conversationId: string,
  responderId: number,
  workspaceId: number = 1,
): Promise<{ continues: boolean; reason?: string }> {
  const db = getDatabase()
  const state = getState(db, conversationId)

  if (!state) throw new Error(`Conversation ${conversationId} not found`)
  if (state.status !== 'active') {
    return { continues: false, reason: `Conversation is ${state.status}` }
  }

  const config: ConversationConfig = state.config ? JSON.parse(state.config) : DEFAULT_CONFIG

  // Check message limit
  const messages = getConversationMessages(db, conversationId)
  if (messages.length >= config.maxMessages) {
    updateState(db, conversationId, { status: 'timeout' })
    return { continues: false, reason: 'Message limit reached' }
  }

  // Check time limit
  const now = Math.floor(Date.now() / 1000)
  const elapsedMs = (now - state.started_at) * 1000
  if (elapsedMs >= config.maxDurationMs) {
    updateState(db, conversationId, { status: 'timeout' })
    return { continues: false, reason: 'Time limit reached' }
  }

  // Check hop guard
  if (state.hop_count >= config.maxHops) {
    updateState(db, conversationId, { status: 'paused' })
    return { continues: false, reason: `Hop limit reached (${config.maxHops})` }
  }

  const responder = getAgent(db, responderId, workspaceId)
  if (!responder) throw new Error(`Responder agent ${responderId} not found`)

  // Build system prompt
  const responderConfig = responder.config ? JSON.parse(responder.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: responder.name,
    role: responder.role,
    soul_content: responder.soul_content,
    config: responderConfig,
  })

  // Recall relevant memories
  const recentContent = messages.slice(-3).map((m) => m.content).join(' ')
  let memoryContext = ''
  try {
    const memories = recall(responderId, recentContent, workspaceId, 3)
    if (memories.length > 0) {
      memoryContext = '\n\nRelevant memories:\n' + memories.map((m) => `- ${m.description}`).join('\n')
    }
  } catch {
    // Memory system may not be available
  }

  // Build message history for LLM
  const llmMessages = [
    { role: 'system' as const, content: systemPrompt + memoryContext },
    ...messages.map((m) => ({
      role: (m.from_agent === responder.name ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  const response = await complete(llmMessages, {
    agentId: responderId,
    workspaceId,
    taskType: 'conversation',
  })

  const responseText = response.text.trim()

  // Check for consensus
  const consensus = detectConsensus(responseText, config.consensusKeyword)
  if (consensus !== null) {
    storeMessage(db, conversationId, responder.name, null, responseText, 'continue')
    updateState(db, conversationId, {
      status: 'consensus',
      consensus,
      hop_count: state.hop_count + 1,
    })
    return { continues: false, reason: 'Consensus reached' }
  }

  // Determine who the response is directed to
  const lastMessage = messages[messages.length - 1]
  const toAgent = lastMessage ? lastMessage.from_agent : null

  storeMessage(db, conversationId, responder.name, toAgent, responseText, 'continue')
  updateState(db, conversationId, { hop_count: state.hop_count + 1 })

  return { continues: true }
}

/**
 * End a conversation — agent says goodbye and stores memory of the exchange.
 */
export async function leaveConversation(
  agentId: number,
  conversationId: string,
  workspaceId: number = 1,
): Promise<void> {
  const db = getDatabase()
  const state = getState(db, conversationId)
  if (!state) throw new Error(`Conversation ${conversationId} not found`)

  const agent = getAgent(db, agentId, workspaceId)
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  const messages = getConversationMessages(db, conversationId)

  // Generate farewell
  const agentConfig = agent.config ? JSON.parse(agent.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: agent.name, role: agent.role,
    soul_content: agent.soul_content, config: agentConfig,
  })

  const response = await complete(
    [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: (m.from_agent === agent.name ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: 'The conversation is ending. Say a brief goodbye (1 sentence).' },
    ],
    { agentId, workspaceId, taskType: 'conversation' },
  )

  storeMessage(db, conversationId, agent.name, null, response.text.trim(), 'leave')

  // Summarize and store as memory
  const conversationSummary = messages.map((m) => `${m.from_agent}: ${m.content}`).join('\n')
  try {
    const summaryResponse = await complete(
      [
        { role: 'system', content: 'Summarize this conversation in 1-2 sentences from the perspective of the agent leaving.' },
        { role: 'user', content: conversationSummary },
      ],
      { agentId, workspaceId, taskType: 'summarization' },
    )
    await observe(agentId, summaryResponse.text.trim(), workspaceId)
  } catch (err) {
    logger.warn({ err, agentId, conversationId }, 'Failed to store conversation memory')
  }

  updateState(db, conversationId, { status: 'completed' })
  logger.info({ agentId, conversationId }, 'Agent left conversation')
}

/**
 * Get conversation state and messages.
 */
export function getConversation(conversationId: string): {
  state: ConversationState | null
  messages: MessageRow[]
} {
  const db = getDatabase()
  return {
    state: getState(db, conversationId),
    messages: getConversationMessages(db, conversationId),
  }
}

/**
 * Reset hop counter for a paused conversation (human-in-the-loop reset).
 */
export function resetHopCounter(conversationId: string): void {
  const db = getDatabase()
  updateState(db, conversationId, { hop_count: 0, status: 'active' })
}

/**
 * Start a multi-agent debate with round-robin turns and break conditions.
 * ChatDev ComposedPhase pattern adapted for MC.
 */
export async function startDebate(
  topic: string,
  participantIds: number[],
  workspaceId: number = 1,
  config?: Partial<DebateConfig>,
): Promise<{ conversationId: string; outcome: 'consensus' | 'max_cycles' | 'budget' }> {
  if (participantIds.length < 2) throw new Error('Debate requires at least 2 participants')

  const db = getDatabase()
  const debateConfig: DebateConfig = {
    maxMessages: 50,
    maxDurationMs: 1800000, // 30 min
    consensusKeyword: '<DONE>',
    maxHops: 50,
    needReflect: true,
    participants: participantIds,
    maxCycles: config?.maxCycles ?? 3,
    breakCondition: config?.breakCondition ?? { type: 'keyword', keyword: '<DONE>' },
    ...config,
  }

  const conversationId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Create conversation state
  db.prepare(
    `INSERT INTO conversation_state (conversation_id, status, hop_count, initiator_agent_id, started_at, max_messages, max_duration_ms, config)
     VALUES (?, 'active', 0, ?, ?, ?, ?, ?)`
  ).run(conversationId, participantIds[0], now, debateConfig.maxMessages, debateConfig.maxDurationMs, JSON.stringify(debateConfig))

  // Load all participants
  const agents: AgentRow[] = []
  for (const id of participantIds) {
    const agent = getAgent(db, id, workspaceId)
    if (!agent) throw new Error(`Agent ${id} not found`)
    agents.push(agent)
  }

  // Round-robin debate loop
  let cycle = 0
  let turnIndex = 0
  let outcome: 'consensus' | 'max_cycles' | 'budget' = 'max_cycles'

  while (cycle < debateConfig.maxCycles) {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[turnIndex % agents.length]
      turnIndex++

      // Check break condition BEFORE turn (ChatDev pattern)
      const messages = getConversationMessages(db, conversationId)
      if (messages.length > 0 && debateConfig.breakCondition.type === 'keyword') {
        const lastMsg = messages[messages.length - 1]
        if (lastMsg.content.includes(debateConfig.breakCondition.keyword)) {
          const conclusion = detectConsensus(lastMsg.content, debateConfig.breakCondition.keyword)
          updateState(db, conversationId, { status: 'consensus', consensus: conclusion })
          outcome = 'consensus'
          logger.info({ conversationId, cycle }, 'Debate reached consensus')
          return { conversationId, outcome }
        }
      }

      // Build prompt
      const agentConfig = agent.config ? JSON.parse(agent.config) : {}
      const systemPrompt = buildSystemPrompt({
        name: agent.name, role: agent.role,
        soul_content: agent.soul_content, config: agentConfig,
      })

      const context = messages.length > 0
        ? messages.slice(-10).map((m) => `${m.from_agent}: ${m.content}`).join('\n')
        : `Topic: ${topic}`

      const phase = messages.length === 0 ? 'start' : 'continue'

      try {
        const response = await complete(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `You are in a group debate about: ${topic}\n\nConversation so far:\n${context}\n\nProvide your perspective (max 200 chars). If you agree with the final conclusion, include "${debateConfig.breakCondition.type === 'keyword' ? debateConfig.breakCondition.keyword : '<DONE>'}" in your response.` },
          ],
          { agentId: agent.id, workspaceId, taskType: 'conversation' },
        )

        storeMessage(db, conversationId, agent.name, null, response.text.trim(), phase as 'start' | 'continue')
        updateState(db, conversationId, { hop_count: turnIndex })

        // Check break condition AFTER turn (ChatDev pattern)
        if (debateConfig.breakCondition.type === 'keyword' && response.text.includes(debateConfig.breakCondition.keyword)) {
          const conclusion = detectConsensus(response.text, debateConfig.breakCondition.keyword)
          updateState(db, conversationId, { status: 'consensus', consensus: conclusion })
          outcome = 'consensus'
          logger.info({ conversationId, cycle, agent: agent.name }, 'Debate reached consensus')
          return { conversationId, outcome }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('exceeded')) {
          updateState(db, conversationId, { status: 'paused' })
          outcome = 'budget'
          return { conversationId, outcome }
        }
        logger.warn({ err, agentId: agent.id, conversationId }, 'Debate turn failed')
      }
    }
    cycle++
  }

  // Max cycles reached
  updateState(db, conversationId, { status: 'completed' })
  logger.info({ conversationId, cycles: cycle }, 'Debate completed (max cycles)')
  return { conversationId, outcome }
}
