/**
 * Agent Action Router — bridges simulation engine tick with Layer 2 systems.
 *
 * Checks Layer 2 state (mentions, workflows, debates) for pending work
 * assigned to a specific agent. Returns a prioritized action for the
 * simulation engine tick to execute.
 *
 * Priority order:
 *   1. Pending @mentions (respond to conversations)
 *   2. Running workflow phases (execute assigned work)
 *   3. Active debate turns (participate in deliberation)
 */

import type Database from 'better-sqlite3'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { complete, checkAgentBudget } from '@/lib/llm/router'
import { buildSystemPrompt, getMentalState, updateMentalState } from '@/lib/persona-engine'
import { recall, observe } from '@/lib/agent-memory'
import { eventBus } from '@/lib/event-bus'
import { submitArgument, castVote, getDebateStatus, advanceDebatePhase } from '@/lib/debate-engine'
import { completePhase, advanceWorkflow } from '@/lib/workflow-engine'

// --- Types ---

export type AgentActionType = 'mention_response' | 'workflow_phase' | 'debate_turn'

export interface MentionAction {
  type: 'mention_response'
  messageId: number
  conversationId: string
  content: string
  fromAgent: string
}

export interface WorkflowAction {
  type: 'workflow_phase'
  runId: number
  phaseRunId: number
  phaseName: string
  inputArtifact: string | null
  outputSchema: string | null
  description: string | null
}

export interface DebateAction {
  type: 'debate_turn'
  debateId: number
  topic: string
  currentPhase: 'propose' | 'critique' | 'rebut' | 'vote'
  currentRound: number
  agentId: number
}

export type AgentActionData = MentionAction | WorkflowAction | DebateAction

export interface AgentAction {
  type: AgentActionType
  priority: number
  data: AgentActionData
}

interface AgentContext {
  id: number
  name: string
  role: string
  soul_content: string | null
  config: string | null
  workspace_id: number
}

// --- Constants ---

/** Only check mentions from the last hour to avoid infinite backlog. */
const MENTION_LOOKBACK_SECONDS = 3600

/** Max consecutive agent-to-agent turns before requiring human intervention. */
const MAX_AGENT_TURNS = 3

// --- Query Functions ---

/**
 * Find the oldest @mention of this agent that hasn't been responded to.
 * Checks messages from the last hour containing the agent's handle.
 */
export function checkPendingMentions(
  db: Database.Database,
  agentId: number,
  agentName: string,
  workspaceId: number
): MentionAction | null {
  const handle = agentName.trim().toLowerCase().replace(/\s+/g, '-')
  const cutoff = Math.floor(Date.now() / 1000) - MENTION_LOOKBACK_SECONDS

  const pending = db.prepare(`
    SELECT m.id, m.conversation_id, m.content, m.from_agent
    FROM messages m
    WHERE m.workspace_id = ?
      AND m.content LIKE ?
      AND m.from_agent != ?
      AND m.created_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.conversation_id = m.conversation_id
          AND m2.from_agent = ?
          AND m2.created_at > m.created_at
      )
    ORDER BY m.created_at ASC
    LIMIT 1
  `).get(workspaceId, `%@${handle}%`, agentName, cutoff, agentName) as {
    id: number
    conversation_id: string
    content: string
    from_agent: string
  } | undefined

  if (!pending) return null

  return {
    type: 'mention_response',
    messageId: pending.id,
    conversationId: pending.conversation_id,
    content: pending.content,
    fromAgent: pending.from_agent,
  }
}

/**
 * Find a running workflow phase assigned to this agent's role.
 */
export function checkPendingWorkflowPhases(
  db: Database.Database,
  agentRole: string,
  workspaceId: number
): WorkflowAction | null {
  const pending = db.prepare(`
    SELECT wpr.id as phaseRunId, wpr.run_id as runId, wpr.input_artifact,
           wp.name as phaseName, wp.output_schema, wp.description
    FROM workflow_phase_runs wpr
    JOIN workflow_phases wp ON wpr.phase_id = wp.id
    JOIN workflow_runs wr ON wpr.run_id = wr.id
    WHERE wpr.status = 'running'
      AND wr.status = 'running'
      AND wr.workspace_id = ?
      AND wp.agent_role = ?
    ORDER BY wpr.started_at ASC
    LIMIT 1
  `).get(workspaceId, agentRole) as {
    phaseRunId: number
    runId: number
    input_artifact: string | null
    phaseName: string
    output_schema: string | null
    description: string | null
  } | undefined

  if (!pending) return null

  return {
    type: 'workflow_phase',
    runId: pending.runId,
    phaseRunId: pending.phaseRunId,
    phaseName: pending.phaseName,
    inputArtifact: pending.input_artifact,
    outputSchema: pending.output_schema,
    description: pending.description,
  }
}

/**
 * Find an active debate where this agent hasn't acted in the current round/phase.
 */
export function checkPendingDebateTurns(
  db: Database.Database,
  agentId: number,
  workspaceId: number
): DebateAction | null {
  const pending = db.prepare(`
    SELECT d.id as debateId, d.topic, d.status as currentPhase, d.current_round
    FROM debates d
    JOIN debate_participants dp ON d.id = dp.debate_id
    WHERE dp.agent_id = ?
      AND d.workspace_id = ?
      AND d.status IN ('propose', 'critique', 'rebut', 'vote')
      AND (
        (d.status IN ('propose', 'critique', 'rebut') AND NOT EXISTS (
          SELECT 1 FROM debate_arguments da
          WHERE da.debate_id = d.id
            AND da.agent_id = ?
            AND da.round_number = d.current_round
            AND da.phase = d.status
        ))
        OR
        (d.status = 'vote' AND NOT EXISTS (
          SELECT 1 FROM debate_votes dv
          WHERE dv.debate_id = d.id AND dv.agent_id = ?
        ))
      )
    ORDER BY d.created_at ASC
    LIMIT 1
  `).get(agentId, workspaceId, agentId, agentId) as {
    debateId: number
    topic: string
    currentPhase: 'propose' | 'critique' | 'rebut' | 'vote'
    current_round: number
  } | undefined

  if (!pending) return null

  return {
    type: 'debate_turn',
    debateId: pending.debateId,
    topic: pending.topic,
    currentPhase: pending.currentPhase,
    currentRound: pending.current_round,
    agentId,
  }
}

/**
 * Return the highest priority pending action for this agent, or null.
 */
export function getAgentPrioritizedAction(
  db: Database.Database,
  agentId: number,
  agentName: string,
  agentRole: string,
  workspaceId: number
): AgentAction | null {
  const mention = checkPendingMentions(db, agentId, agentName, workspaceId)
  if (mention) {
    return { type: 'mention_response', priority: 1, data: mention }
  }

  const workflow = checkPendingWorkflowPhases(db, agentRole, workspaceId)
  if (workflow) {
    return { type: 'workflow_phase', priority: 2, data: workflow }
  }

  const debate = checkPendingDebateTurns(db, agentId, workspaceId)
  if (debate) {
    return { type: 'debate_turn', priority: 3, data: debate }
  }

  return null
}

// --- Execution Functions ---

/**
 * Generate and post an LLM response to a pending @mention.
 * Uses persona for system prompt, memory for context.
 * Respects agent-to-agent loop prevention.
 */
export async function respondToMention(
  db: Database.Database,
  agent: AgentContext,
  action: MentionAction
): Promise<void> {
  // Loop prevention: count consecutive agent messages in this thread
  const recentMessages = db.prepare(`
    SELECT from_agent FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(action.conversationId) as Array<{ from_agent: string }>

  let agentTurnCount = 0
  for (const msg of recentMessages) {
    if (msg.from_agent === 'user' || msg.from_agent === 'human' || msg.from_agent === 'system') break
    agentTurnCount++
  }

  if (agentTurnCount >= MAX_AGENT_TURNS) {
    logger.info(
      { agentId: agent.id, conversationId: action.conversationId, turns: agentTurnCount },
      'Skipping mention response — agent turn limit reached'
    )
    return
  }

  // Build conversation context
  const contextMessages = db.prepare(`
    SELECT from_agent, content FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(action.conversationId) as Array<{ from_agent: string; content: string }>

  const threadContext = contextMessages
    .reverse()
    .map((m) => `${m.from_agent}: ${m.content}`)
    .join('\n')

  // Build system prompt with persona
  const agentConfig = agent.config ? JSON.parse(agent.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: agent.name,
    role: agent.role,
    soul_content: agent.soul_content,
    config: agentConfig,
  })

  // Retrieve relevant memories
  let memoryContext = ''
  try {
    const memories = recall(agent.id, action.content, agent.workspace_id, 3)
    if (memories.length > 0) {
      memoryContext = '\n\nRelevant memories:\n' + memories.map((m) => `- ${m.description}`).join('\n')
    }
  } catch {
    // Memory system not available
  }

  const response = await complete(
    [
      { role: 'system', content: systemPrompt + memoryContext },
      {
        role: 'user',
        content: `You are in a team chat conversation. Here is the recent thread:\n\n${threadContext}\n\nRespond naturally to this message from ${action.fromAgent}. Keep your response concise and relevant.`,
      },
    ],
    { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'conversation' }
  )

  const responseText = response.text.trim()

  // Insert response message
  db.prepare(`
    INSERT INTO messages (conversation_id, from_agent, content, workspace_id, created_at)
    VALUES (?, ?, ?, ?, unixepoch())
  `).run(action.conversationId, agent.name, responseText, agent.workspace_id)

  // Record in memory
  try {
    await observe(
      agent.id,
      `Responded to ${action.fromAgent} in chat: "${responseText.slice(0, 100)}"`,
      agent.workspace_id
    )
  } catch {
    // Memory not available
  }

  eventBus.broadcast('chat.mention.response', {
    messageId: action.messageId,
    agentName: agent.name,
    conversationId: action.conversationId,
  })

  logger.info(
    { agentId: agent.id, conversationId: action.conversationId },
    'Agent responded to mention'
  )
}

/**
 * Execute an assigned workflow phase by generating output artifacts via LLM.
 * Validates output against schema, then advances the workflow.
 */
export async function executeWorkflowPhase(
  db: Database.Database,
  agent: AgentContext,
  action: WorkflowAction
): Promise<void> {
  const agentConfig = agent.config ? JSON.parse(agent.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: agent.name,
    role: agent.role,
    soul_content: agent.soul_content,
    config: agentConfig,
  })

  // Build the phase execution prompt
  let prompt = `You are executing workflow phase "${action.phaseName}".`
  if (action.description) {
    prompt += `\n\nPhase description: ${action.description}`
  }
  if (action.inputArtifact) {
    prompt += `\n\nInput from previous phase:\n${action.inputArtifact}`
  }
  if (action.outputSchema) {
    prompt += `\n\nYour output MUST be valid JSON matching this schema:\n${action.outputSchema}`
    prompt += '\n\nRespond with ONLY the JSON output, no explanation.'
  } else {
    prompt += '\n\nProvide your output for this phase. Be thorough and structured.'
  }

  const response = await complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'workflow-execution' }
  )

  const outputArtifact = response.text.trim()

  // Complete the phase (validates against schema internally)
  const result = completePhase(db, action.runId, action.phaseRunId, outputArtifact)

  if (result.validationError) {
    logger.warn(
      { agentId: agent.id, runId: action.runId, error: result.validationError },
      'Workflow phase output validation failed'
    )
    // Record the attempt in memory
    try {
      await observe(
        agent.id,
        `Attempted workflow phase "${action.phaseName}" but output failed validation: ${result.validationError}`,
        agent.workspace_id
      )
    } catch {
      // Memory not available
    }
    return
  }

  // Advance to next phase
  const advance = advanceWorkflow(db, action.runId)

  // Record in memory
  try {
    await observe(
      agent.id,
      `Completed workflow phase "${action.phaseName}" (run ${action.runId}). Next: ${advance.status}`,
      agent.workspace_id
    )
  } catch {
    // Memory not available
  }

  logger.info(
    { agentId: agent.id, runId: action.runId, phase: action.phaseName, next: advance.status },
    'Agent completed workflow phase'
  )
}

/**
 * Participate in an active debate — submit argument or cast vote.
 * Persona traits influence stance and reasoning style.
 */
export async function participateInDebate(
  db: Database.Database,
  agent: AgentContext,
  action: DebateAction
): Promise<void> {
  const agentConfig = agent.config ? JSON.parse(agent.config) : {}
  const systemPrompt = buildSystemPrompt({
    name: agent.name,
    role: agent.role,
    soul_content: agent.soul_content,
    config: agentConfig,
  })

  // Get debate context
  const status = getDebateStatus(db, action.debateId)
  if (!status) return

  const priorArgs = status.arguments
    .filter((a) => a.round_number === action.currentRound || a.round_number === action.currentRound - 1)
    .map((a) => `[${a.phase}] ${a.agent_name}: ${a.content}`)
    .join('\n\n')

  // Extract persona traits to influence stance
  const persona = agentConfig?.persona
  const agreeableness = persona?.personality?.agreeableness ?? 0.5
  const conscientiousness = persona?.personality?.conscientiousness ?? 0.5

  if (action.currentPhase === 'vote') {
    await castDebateVote(db, agent, action, status, systemPrompt, agreeableness)
    return
  }

  // Generate argument for propose/critique/rebut
  let prompt = `Topic: "${action.topic}"\n\nPhase: ${action.currentPhase} (Round ${action.currentRound})\n\n`

  if (priorArgs) {
    prompt += `Previous arguments:\n${priorArgs}\n\n`
  }

  if (action.currentPhase === 'propose') {
    prompt += 'Present your initial position on this topic. Be clear and provide reasoning.'
  } else if (action.currentPhase === 'critique') {
    prompt += 'Critique the proposals made. Identify weaknesses, risks, or gaps.'
    if (conscientiousness > 0.7) {
      prompt += ' Be thorough and detail-oriented in your analysis.'
    }
  } else if (action.currentPhase === 'rebut') {
    prompt += 'Respond to critiques of your position. Address concerns or concede valid points.'
    if (agreeableness > 0.7) {
      prompt += ' Be open to adjusting your position if critiques are valid.'
    }
  }

  prompt += '\n\nKeep your response focused and under 300 words.'

  const response = await complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'debate' }
  )

  const confidence = action.currentPhase === 'propose'
    ? 0.7 + (conscientiousness * 0.3)
    : 0.5 + (conscientiousness * 0.3)

  submitArgument(db, action.debateId, action.agentId, response.text.trim(), confidence)

  try {
    await observe(
      agent.id,
      `Submitted ${action.currentPhase} argument in debate "${action.topic}" (round ${action.currentRound})`,
      agent.workspace_id
    )
  } catch {
    // Memory not available
  }

  logger.info(
    { agentId: agent.id, debateId: action.debateId, phase: action.currentPhase },
    'Agent submitted debate argument'
  )
}

/**
 * Cast a vote in a debate based on arguments and persona.
 */
async function castDebateVote(
  db: Database.Database,
  agent: AgentContext,
  action: DebateAction,
  status: NonNullable<ReturnType<typeof getDebateStatus>>,
  systemPrompt: string,
  agreeableness: number
): Promise<void> {
  const allArgs = status.arguments
    .map((a) => `[R${a.round_number} ${a.phase}] ${a.agent_name}: ${a.content}`)
    .join('\n\n')

  const prompt = `Topic: "${action.topic}"\n\nAll arguments:\n${allArgs}\n\nBased on the debate, cast your vote: "accept" or "reject" the proposal.\nRespond with a JSON object: { "vote": "accept" or "reject", "reason": "brief explanation" }`

  const response = await complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'debate' }
  )

  let vote: 'accept' | 'reject' = 'accept'
  let reason = response.text.trim()

  try {
    const parsed = JSON.parse(response.text.trim())
    vote = parsed.vote === 'reject' ? 'reject' : 'accept'
    reason = parsed.reason || reason
  } catch {
    // If LLM didn't produce JSON, use agreeableness as tiebreaker
    vote = agreeableness > 0.5 ? 'accept' : 'reject'
  }

  const voteResult = castVote(db, action.debateId, action.agentId, vote, reason)

  // If all voted, advance the debate phase
  if (voteResult.allVoted) {
    try {
      advanceDebatePhase(db, action.debateId)
    } catch (err) {
      logger.warn({ err, debateId: action.debateId }, 'Failed to advance debate after vote')
    }
  }

  try {
    await observe(
      agent.id,
      `Voted "${vote}" in debate "${action.topic}": ${reason.slice(0, 100)}`,
      agent.workspace_id
    )
  } catch {
    // Memory not available
  }

  logger.info(
    { agentId: agent.id, debateId: action.debateId, vote },
    'Agent cast debate vote'
  )
}

/**
 * Execute any pending autonomous action for an agent.
 * Called by the simulation engine tick between existing priorities.
 * Returns true if an action was executed, false if nothing to do.
 */
export async function executeAutonomousAction(
  agent: AgentContext
): Promise<boolean> {
  const db = getDatabase()

  // Budget check first
  const budget = checkAgentBudget(agent.id, agent.workspace_id)
  if (!budget.allowed) {
    return false
  }

  const action = getAgentPrioritizedAction(
    db,
    agent.id,
    agent.name,
    agent.role,
    agent.workspace_id
  )

  if (!action) return false

  switch (action.data.type) {
    case 'mention_response':
      await respondToMention(db, agent, action.data)
      return true

    case 'workflow_phase':
      await executeWorkflowPhase(db, agent, action.data)
      return true

    case 'debate_turn':
      await participateInDebate(db, agent, action.data)
      return true

    default:
      return false
  }
}
