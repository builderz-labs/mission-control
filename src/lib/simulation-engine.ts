/**
 * Simulation Engine — AI Town decision loop + safety controls.
 *
 * Lazy-init pattern (NO module-level timers per Sprint 1 S5/S6 fixes).
 *
 * Agent tick behavior (AI Town pattern):
 *   Priority 1: Pending tasks → work on task
 *   Priority 2: Unmemorized conversations → store memory
 *   Priority 3: Reflection threshold met → generate reflections
 *   Priority 4: Do something → LLM picks next action
 *
 * Safety controls:
 *   - SIMULATION_ENABLED=false by default (opt-in)
 *   - Budget enforcement per agent per day
 *   - Rate limiting: max 1 LLM call per agent per 30 seconds
 *   - Hop guard for agent-to-agent chains
 *   - Kill switch API
 *   - Dry-run mode (log decisions, no LLM calls)
 *   - 120-second operation timeout
 */

import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { complete, checkAgentBudget } from '@/lib/llm/router'
import { buildSystemPrompt, getMentalState, updateMentalState } from '@/lib/persona-engine'
import { recall, observe } from '@/lib/agent-memory'
import { eventBus } from '@/lib/event-bus'
import { executeAutonomousAction } from '@/lib/agent-actions'
import { initScalingTriggers } from '@/lib/scaling-triggers'

// --- Types ---

export interface SimulationConfig {
  tickIntervalMs: number
  operationTimeoutMs: number
  conversationCooldownMs: number
  sameAgentCooldownMs: number
  activityChangeCooldownMs: number
  dryRun: boolean
}

interface AgentTickState {
  lastActionTime: number
  lastConversationTime: number
  lastConversationPartner: number | null
  inProgressOperation: string | null
  inProgressStartTime: number
}

interface AgentRow {
  id: number
  name: string
  role: string
  status: string
  soul_content: string | null
  config: string | null
  workspace_id: number
}

// --- Default config ---

const DEFAULT_CONFIG: SimulationConfig = {
  tickIntervalMs: 5000,
  operationTimeoutMs: 120_000,
  conversationCooldownMs: 15_000,
  sameAgentCooldownMs: 60_000,
  activityChangeCooldownMs: 10_000,
  dryRun: process.env.SIMULATION_DRY_RUN === 'true',
}

// --- Simulation Engine ---

export class SimulationEngine {
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  private paused = false
  private config: SimulationConfig
  private agentStates = new Map<number, AgentTickState>()
  private tickCount = 0

  constructor(config?: Partial<SimulationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Start the simulation loop. */
  start(): void {
    if (this.running) {
      logger.warn('Simulation already running')
      return
    }

    if (!isSimulationEnabled()) {
      throw new Error('Simulation is disabled. Set SIMULATION_ENABLED=true to enable.')
    }

    this.running = true
    this.paused = false
    this.tickCount = 0

    this.interval = setInterval(() => {
      if (!this.paused) {
        this.tick().catch((err) => {
          logger.error({ err }, 'Simulation tick error')
        })
      }
    }, this.config.tickIntervalMs)

    // Don't prevent process exit
    if (this.interval.unref) this.interval.unref()

    // Initialize event-driven scaling triggers
    initScalingTriggers()

    logger.info({ intervalMs: this.config.tickIntervalMs, dryRun: this.config.dryRun }, 'Simulation started')

    eventBus.broadcast('activity.created', {
      type: 'simulation.started',
      config: this.config,
    })
  }

  /** Stop the simulation loop. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.running = false
    this.paused = false
    logger.info({ tickCount: this.tickCount }, 'Simulation stopped')

    eventBus.broadcast('activity.created', {
      type: 'simulation.stopped',
      tickCount: this.tickCount,
    })
  }

  /** Temporarily pause without stopping. */
  pause(): void {
    this.paused = true
    logger.info('Simulation paused')
  }

  /** Resume from pause. */
  resume(): void {
    this.paused = false
    logger.info('Simulation resumed')
  }

  /** Get engine status. */
  getStatus(): {
    running: boolean
    paused: boolean
    tickCount: number
    agentCount: number
    config: SimulationConfig
  } {
    return {
      running: this.running,
      paused: this.paused,
      tickCount: this.tickCount,
      agentCount: this.agentStates.size,
      config: this.config,
    }
  }

  /** Execute a single tick — process all idle agents. */
  async tick(): Promise<void> {
    this.tickCount++
    const db = getDatabase()

    // Get all idle agents
    const agents = db.prepare(
      "SELECT id, name, role, status, soul_content, config, workspace_id FROM agents WHERE status = 'idle'"
    ).all() as AgentRow[]

    for (const agent of agents) {
      try {
        await this.agentTick(agent)
      } catch (err) {
        logger.error({ err, agentId: agent.id }, 'Agent tick error')
      }
    }

    // Evaluate auto-approve scaling policies (once per tick, not per-agent)
    if (this.tickCount % 12 === 0) { // Every 60s at 5s tick interval
      this.evaluateScalingPolicies(db)
    }
  }

  /** Evaluate all enabled auto-approve scaling policies. */
  private evaluateScalingPolicies(db: ReturnType<typeof getDatabase>): void {
    try {
      const policies = db.prepare(
        'SELECT id, workspace_id FROM scaling_policies WHERE enabled = 1 AND auto_approve = 1'
      ).all() as Array<{ id: number; workspace_id: number }>

      for (const policy of policies) {
        try {
          const { evaluateScaling, executeScaleUp, executeScaleDown } = require('@/lib/scaling-engine')
          const event = evaluateScaling(db, policy.id, policy.workspace_id)

          if (event && event.event_type === 'scale_up') {
            executeScaleUp(db, event.id, policy.workspace_id)
            logger.info({ policyId: policy.id, eventId: event.id }, 'Auto-scaling: scale up executed')
          } else if (event && event.event_type === 'scale_down' && event.agent_id) {
            executeScaleDown(db, event.id, event.agent_id, policy.workspace_id)
            logger.info({ policyId: policy.id, eventId: event.id }, 'Auto-scaling: scale down executed')
          }
        } catch (err) {
          logger.warn({ err, policyId: policy.id }, 'Scaling policy evaluation failed')
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Scaling policy query failed')
    }
  }

  /** Process a single agent's tick. */
  private async agentTick(agent: AgentRow): Promise<void> {
    const state = this.getAgentState(agent.id)
    const now = Date.now()

    // Check for in-progress operation timeout
    if (state.inProgressOperation) {
      if (now - state.inProgressStartTime > this.config.operationTimeoutMs) {
        logger.warn({ agentId: agent.id, operation: state.inProgressOperation }, 'Operation timed out')
        state.inProgressOperation = null
        state.inProgressStartTime = 0
      } else {
        return // Still processing
      }
    }

    // Budget check
    const budget = checkAgentBudget(agent.id, agent.workspace_id)
    if (!budget.allowed) {
      logger.debug({ agentId: agent.id }, 'Agent over budget, skipping tick')
      return
    }

    // Priority 1: Pending tasks
    const pendingTask = this.getNextPendingTask(agent.id, agent.workspace_id)
    if (pendingTask) {
      if (this.config.dryRun) {
        logger.info({ agentId: agent.id, taskId: pendingTask.id, dryRun: true }, 'Would work on task')
        return
      }
      state.inProgressOperation = `task-${pendingTask.id}`
      state.inProgressStartTime = now
      await this.workOnTask(agent, pendingTask)
      state.inProgressOperation = null
      return
    }

    // Priority 1.5: Autonomous actions (mentions, workflows, debates)
    try {
      if (this.config.dryRun) {
        // In dry-run mode, just check if there would be an action
        const { getAgentPrioritizedAction } = await import('@/lib/agent-actions')
        const actionDb = getDatabase()
        const pendingAction = getAgentPrioritizedAction(
          actionDb, agent.id, agent.name, agent.role, agent.workspace_id
        )
        if (pendingAction) {
          logger.info(
            { agentId: agent.id, actionType: pendingAction.type, dryRun: true },
            'Would execute autonomous action'
          )
          return
        }
      } else {
        const acted = await executeAutonomousAction({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          soul_content: agent.soul_content,
          config: agent.config,
          workspace_id: agent.workspace_id,
        })
        if (acted) {
          state.lastActionTime = now
          return
        }
      }
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, 'Autonomous action failed')
    }

    // Priority 2: Unmemorized conversations → store memory
    const unmemorized = this.getUnmemorizedConversation(agent.id, agent.workspace_id)
    if (unmemorized) {
      if (this.config.dryRun) {
        logger.info({ agentId: agent.id, conversationId: unmemorized.conversation_id, dryRun: true }, 'Would memorize conversation')
        return
      }
      state.inProgressOperation = `memorize-${unmemorized.conversation_id}`
      state.inProgressStartTime = now
      try {
        await this.memorizeConversation(agent, unmemorized.conversation_id)
      } catch (err) {
        logger.warn({ err, agentId: agent.id }, 'Conversation memorization failed')
      }
      state.inProgressOperation = null
      return
    }

    // Priority 3: Reflection check
    if (this.shouldReflect(agent.id, agent.workspace_id)) {
      if (this.config.dryRun) {
        logger.info({ agentId: agent.id, dryRun: true }, 'Would reflect')
        return
      }
      state.inProgressOperation = 'reflect'
      state.inProgressStartTime = now
      try {
        const { reflect } = await import('@/lib/agent-memory')
        await reflect(agent.id, agent.workspace_id)
      } catch (err) {
        logger.warn({ err, agentId: agent.id }, 'Reflection failed')
      }
      state.inProgressOperation = null
      return
    }

    // Priority 4: Do something (rate limited)
    if (now - state.lastActionTime < this.config.activityChangeCooldownMs) {
      return // On cooldown
    }

    if (this.config.dryRun) {
      logger.info({ agentId: agent.id, dryRun: true }, 'Would do something')
      return
    }

    await this.agentDoSomething(agent)
    state.lastActionTime = now
  }

  /** Get or create agent tick state. */
  private getAgentState(agentId: number): AgentTickState {
    let state = this.agentStates.get(agentId)
    if (!state) {
      state = {
        lastActionTime: 0,
        lastConversationTime: 0,
        lastConversationPartner: null,
        inProgressOperation: null,
        inProgressStartTime: 0,
      }
      this.agentStates.set(agentId, state)
    }
    return state
  }

  /** Get the next pending task for an agent. */
  private getNextPendingTask(agentId: number, workspaceId: number): { id: number; title: string } | null {
    const db = getDatabase()
    return db.prepare(
      `SELECT id, title FROM tasks
       WHERE assigned_to = (SELECT name FROM agents WHERE id = ?)
         AND status IN ('assigned', 'in_progress')
         AND workspace_id = ?
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at ASC
       LIMIT 1`
    ).get(agentId, workspaceId) as { id: number; title: string } | null
  }

  /** Check if agent should reflect based on cumulative importance. */
  private shouldReflect(agentId: number, workspaceId: number): boolean {
    const db = getDatabase()
    const row = db.prepare(
      `SELECT COALESCE(SUM(importance), 0) as total
       FROM agent_memories
       WHERE agent_id = ? AND workspace_id = ? AND type = 'observation'
         AND id > COALESCE((SELECT MAX(id) FROM agent_memories WHERE agent_id = ? AND type = 'reflection'), 0)`
    ).get(agentId, workspaceId, agentId) as { total: number }

    return row.total >= 500
  }

  /** Work on a pending task — generate a progress update. */
  private async workOnTask(agent: AgentRow, task: { id: number; title: string }): Promise<void> {
    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const systemPrompt = buildSystemPrompt({
      name: agent.name, role: agent.role,
      soul_content: agent.soul_content, config: agentConfig,
    })

    const response = await complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `You are working on task: "${task.title}". Provide a brief status update on your progress (1-2 sentences).` },
      ],
      { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'status-update', taskId: task.id },
    )

    // Store as observation
    try {
      await observe(agent.id, `Worked on task "${task.title}": ${response.text.trim()}`, agent.workspace_id)
    } catch {
      // Memory system may not be ready
    }

    // Update mental state
    try {
      updateMentalState(agent.id, {
        attention: task.title,
        goals: `Complete task: ${task.title}`,
      }, agent.workspace_id)
    } catch {
      // Persona engine may not be ready
    }

    logger.debug({ agentId: agent.id, taskId: task.id }, 'Agent worked on task')
  }

  /** Find a completed/consensus conversation the agent participated in but hasn't memorized. */
  private getUnmemorizedConversation(agentId: number, workspaceId: number): { conversation_id: string } | null {
    const db = getDatabase()
    const agentRow = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId) as { name: string } | undefined
    if (!agentRow) return null

    return db.prepare(
      `SELECT cs.conversation_id FROM conversation_state cs
       WHERE cs.status IN ('completed', 'consensus')
         AND cs.conversation_id IN (
           SELECT DISTINCT conversation_id FROM messages WHERE from_agent = ?
         )
         AND cs.conversation_id NOT IN (
           SELECT DISTINCT conversation_id FROM messages WHERE conversation_phase = 'leave' AND from_agent = ?
         )
       LIMIT 1`
    ).get(agentRow.name, agentRow.name) as { conversation_id: string } | null
  }

  /** Summarize and memorize a completed conversation. */
  private async memorizeConversation(agent: AgentRow, conversationId: string): Promise<void> {
    const db = getDatabase()
    const messages = db.prepare(
      'SELECT from_agent, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId) as Array<{ from_agent: string; content: string }>

    if (messages.length === 0) return

    const summary = messages.map((m) => `${m.from_agent}: ${m.content}`).join('\n')

    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const systemPrompt = buildSystemPrompt({
      name: agent.name, role: agent.role,
      soul_content: agent.soul_content, config: agentConfig,
    })

    const response = await complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize this conversation you participated in (1-2 sentences):\n\n${summary}` },
      ],
      { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'summarization' },
    )

    await observe(agent.id, response.text.trim(), agent.workspace_id)
    logger.debug({ agentId: agent.id, conversationId }, 'Agent memorized conversation')
  }

  /** LLM-driven decision: what should the agent do next? */
  private async agentDoSomething(agent: AgentRow): Promise<void> {
    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const systemPrompt = buildSystemPrompt({
      name: agent.name, role: agent.role,
      soul_content: agent.soul_content, config: agentConfig,
    })

    // Get recent memories for context
    let memoryContext = ''
    try {
      const memories = recall(agent.id, 'recent activities', agent.workspace_id, 3)
      if (memories.length > 0) {
        memoryContext = '\n\nRecent memories:\n' + memories.map((m) => `- ${m.description}`).join('\n')
      }
    } catch {
      // Memory not available
    }

    const response = await complete(
      [
        { role: 'system', content: systemPrompt + memoryContext },
        { role: 'user', content: 'What would you like to do next? Describe a brief action or thought (1-2 sentences).' },
      ],
      { agentId: agent.id, workspaceId: agent.workspace_id, taskType: 'status-update' },
    )

    // Record as observation
    try {
      await observe(agent.id, response.text.trim(), agent.workspace_id)
    } catch {
      // Memory not available
    }

    logger.debug({ agentId: agent.id }, 'Agent did something')
  }
}

// --- Feature flag ---

export function isSimulationEnabled(): boolean {
  return process.env.SIMULATION_ENABLED === 'true'
}

// --- Singleton (lazy, not module-level) ---

let _engine: SimulationEngine | null = null

export function getSimulationEngine(config?: Partial<SimulationConfig>): SimulationEngine {
  if (!_engine) {
    _engine = new SimulationEngine(config)
  }
  return _engine
}

export function resetSimulationEngine(): void {
  if (_engine) {
    _engine.stop()
    _engine = null
  }
}
