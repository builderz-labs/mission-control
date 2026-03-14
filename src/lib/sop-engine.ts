/**
 * SOP Workflow Engine — MetaGPT pub-sub routing + ChatDev composed phases.
 *
 * Key patterns extracted from MetaGPT:
 *   - Pub-sub: Roles declare watches, pipeline emerges from subscriptions
 *   - Profile-Goal-Constraint roles: auto-generate system prompts
 *   - Dual-content messages: natural language + validated JSON artifact
 *   - Round-based execution: iterate until all roles idle or max rounds
 *   - Output validation: Zod schemas validate LLM outputs with repair
 *
 * Extends MC's existing workflow_templates/pipeline_runs rather than replacing.
 */

import { randomUUID } from 'crypto'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { complete, checkAgentBudget } from '@/lib/llm/router'
import { repairAndParse } from '@/lib/llm/output-repair'
import { eventBus } from '@/lib/event-bus'
import { z } from 'zod'
import type { TaskTier } from '@/lib/llm/inference-adapter'

// --- Types ---

export interface ActionNodeDef {
  key: string
  expectedType: 'string' | 'string[]' | 'number' | 'object'
  instruction: string
  example: unknown
  children?: ActionNodeDef[]
}

export interface SOPAction {
  type: string
  outputSchema?: ActionNodeDef[]
  prompt: string
  tier: TaskTier
}

export interface SOPRole {
  id: string
  profile: string
  goal: string
  constraints: string
  reactMode: 'by_order' | 'react' | 'plan_and_act'
  actions: SOPAction[]
  watches: string[]
}

export interface SOPTemplate {
  name: string
  description?: string
  roles: SOPRole[]
  composed?: boolean
  maxCycles?: number
  breakCondition?: { type: 'keyword'; keyword: string }
}

export interface SOPMessage {
  id: string
  workflow_run_id: string
  content: string
  instruct_content: string | null
  cause_by: string
  sent_from: string
  send_to: string
  created_at: number
}

export interface SOPRoleState {
  workflow_run_id: string
  role_id: string
  state: number
  is_idle: number
  last_observed_msg_id: string | null
}

export interface WorkflowRun {
  id: string
  templateName: string
  status: 'running' | 'completed' | 'failed' | 'budget_exceeded' | 'paused'
  currentRound: number
  maxRounds: number
  agentId: number
  workspaceId: number
}

// --- Pre-built templates ---

export const SOP_TEMPLATES: Record<string, SOPTemplate> = {
  software_project: {
    name: 'Software Project',
    description: 'Full software development cycle: requirements → design → tasks → code → tests',
    roles: [
      {
        id: 'pm', profile: 'Product Manager', goal: 'Create a comprehensive PRD',
        constraints: 'Must include success metrics and acceptance criteria',
        reactMode: 'by_order',
        actions: [{
          type: 'WritePRD', prompt: 'Based on the user requirement, write a Product Requirements Document.',
          tier: 'complex',
          outputSchema: [
            { key: 'overview', expectedType: 'string', instruction: 'Product overview', example: '' },
            { key: 'requirements', expectedType: 'string[]', instruction: 'List of requirements', example: [] },
            { key: 'success_metrics', expectedType: 'string[]', instruction: 'Measurable success criteria', example: [] },
          ],
        }],
        watches: ['UserRequirement'],
      },
      {
        id: 'architect', profile: 'Architect', goal: 'Design the system architecture',
        constraints: 'Must justify technology choices',
        reactMode: 'by_order',
        actions: [{
          type: 'WriteDesign', prompt: 'Based on the PRD, design the system architecture.',
          tier: 'complex',
          outputSchema: [
            { key: 'architecture', expectedType: 'string', instruction: 'Architecture description', example: '' },
            { key: 'components', expectedType: 'string[]', instruction: 'Key components', example: [] },
            { key: 'tech_stack', expectedType: 'string[]', instruction: 'Technology choices', example: [] },
          ],
        }],
        watches: ['WritePRD'],
      },
      {
        id: 'pm_tasks', profile: 'Project Manager', goal: 'Break design into actionable tasks',
        constraints: 'Tasks must be specific and estimable',
        reactMode: 'by_order',
        actions: [{
          type: 'WriteTasks', prompt: 'Based on the design, create a task breakdown.',
          tier: 'standard',
          outputSchema: [
            { key: 'tasks', expectedType: 'string[]', instruction: 'Ordered list of tasks', example: [] },
            { key: 'dependencies', expectedType: 'string', instruction: 'Task dependency notes', example: '' },
          ],
        }],
        watches: ['WriteDesign'],
      },
      {
        id: 'engineer', profile: 'Engineer', goal: 'Write the code',
        constraints: 'Follow the architecture design',
        reactMode: 'by_order',
        actions: [{
          type: 'WriteCode', prompt: 'Implement the code based on the task breakdown.',
          tier: 'complex',
        }],
        watches: ['WriteTasks'],
      },
      {
        id: 'qa', profile: 'QA Engineer', goal: 'Write comprehensive tests',
        constraints: 'Cover edge cases and failure modes',
        reactMode: 'by_order',
        actions: [{
          type: 'WriteTests', prompt: 'Write tests for the implemented code.',
          tier: 'standard',
        }],
        watches: ['WriteCode'],
      },
    ],
  },
  code_review: {
    name: 'Code Review',
    description: 'Iterative code review loop: reviewer critiques, programmer fixes',
    composed: true,
    maxCycles: 3,
    breakCondition: { type: 'keyword', keyword: '<DONE> Approved' },
    roles: [
      {
        id: 'reviewer', profile: 'Code Reviewer', goal: 'Find bugs and improvements',
        constraints: 'Be specific about line numbers and suggest fixes',
        reactMode: 'by_order',
        actions: [{
          type: 'ReviewCode', prompt: 'Review the code. If all issues are resolved, respond with "<DONE> Approved".',
          tier: 'standard',
        }],
        watches: ['UserRequirement', 'FixCode'],
      },
      {
        id: 'programmer', profile: 'Programmer', goal: 'Fix issues found in review',
        constraints: 'Address all review comments',
        reactMode: 'by_order',
        actions: [{
          type: 'FixCode', prompt: 'Fix the issues identified in the code review.',
          tier: 'standard',
        }],
        watches: ['ReviewCode'],
      },
    ],
  },
}

// --- ActionNode to Zod schema conversion ---

function actionNodeToZodSchema(nodes: ActionNodeDef[]): z.ZodType<unknown> {
  const shape: Record<string, z.ZodType<unknown>> = {}
  for (const node of nodes) {
    switch (node.expectedType) {
      case 'string':
        shape[node.key] = z.string()
        break
      case 'string[]':
        shape[node.key] = z.array(z.string())
        break
      case 'number':
        shape[node.key] = z.number()
        break
      case 'object':
        if (node.children) {
          shape[node.key] = actionNodeToZodSchema(node.children)
        } else {
          shape[node.key] = z.record(z.string(), z.unknown())
        }
        break
    }
  }
  return z.object(shape)
}

// --- Core Operations ---

/**
 * Start a new SOP workflow from a template.
 */
export function startWorkflow(
  templateName: string,
  userInput: string,
  agentId: number,
  workspaceId: number = 1,
  maxRounds: number = 20,
): WorkflowRun {
  const template = SOP_TEMPLATES[templateName]
  if (!template) throw new Error(`Unknown SOP template: ${templateName}`)

  const db = getDatabase()
  const runId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Seed with UserRequirement message
  const msgId = randomUUID()
  db.prepare(
    `INSERT INTO sop_messages (id, workflow_run_id, content, cause_by, sent_from, send_to, created_at)
     VALUES (?, ?, ?, 'UserRequirement', 'user', '__all__', ?)`
  ).run(msgId, runId, userInput, now)

  // Initialize role states
  for (const role of template.roles) {
    db.prepare(
      `INSERT INTO sop_role_state (workflow_run_id, role_id, state, is_idle, last_observed_msg_id)
       VALUES (?, ?, -1, 1, NULL)`
    ).run(runId, role.id)
  }

  const run: WorkflowRun = {
    id: runId,
    templateName,
    status: 'running',
    currentRound: 0,
    maxRounds,
    agentId,
    workspaceId,
  }

  eventBus.broadcast('activity.created' as any, {
    type: 'sop.workflow.started',
    runId,
    templateName,
    agentId,
  })

  logger.info({ runId, templateName, agentId }, 'SOP workflow started')
  return run
}

/**
 * Execute one round of the SOP workflow.
 * Returns true if any role acted, false if all idle (workflow complete).
 */
export async function executeRound(
  run: WorkflowRun,
): Promise<{ acted: boolean; round: number }> {
  const template = SOP_TEMPLATES[run.templateName]
  if (!template) throw new Error(`Unknown template: ${run.templateName}`)

  const db = getDatabase()
  run.currentRound++

  if (run.currentRound > run.maxRounds) {
    run.status = 'completed'
    return { acted: false, round: run.currentRound }
  }

  // Budget check
  const budget = checkAgentBudget(run.agentId, run.workspaceId)
  if (!budget.allowed) {
    run.status = 'budget_exceeded'
    logger.warn({ runId: run.id, spent: budget.spent, limit: budget.limit }, 'SOP workflow budget exceeded')
    return { acted: false, round: run.currentRound }
  }

  let anyActed = false

  for (const role of template.roles) {
    // Get role state
    const roleState = db.prepare(
      'SELECT * FROM sop_role_state WHERE workflow_run_id = ? AND role_id = ?'
    ).get(run.id, role.id) as SOPRoleState | undefined

    if (!roleState) continue

    // Observe: check for unprocessed messages matching watches
    const watchConditions = role.watches.map(() => 'cause_by = ?').join(' OR ')
    const newMessages = db.prepare(
      `SELECT * FROM sop_messages
       WHERE workflow_run_id = ? AND (${watchConditions})
         AND (? IS NULL OR id > ?)
       ORDER BY created_at ASC`
    ).all(
      run.id,
      ...role.watches,
      roleState.last_observed_msg_id,
      roleState.last_observed_msg_id,
    ) as SOPMessage[]

    if (newMessages.length === 0) continue

    // React: execute the next action based on reactMode
    const action = role.reactMode === 'by_order'
      ? role.actions[Math.min(roleState.state + 1, role.actions.length - 1)]
      : role.actions[0]

    if (!action) continue

    // Build system prompt from role definition
    const systemPrompt = `You are a ${role.profile}. Your goal is: ${role.goal}. Constraints: ${role.constraints}.`
    const context = newMessages.map((m) => `[${m.cause_by}] ${m.content}`).join('\n\n')

    // Check for composed loop break condition
    if (template.composed && template.breakCondition) {
      const lastMsg = newMessages[newMessages.length - 1]
      if (lastMsg && template.breakCondition.type === 'keyword' && lastMsg.content.includes(template.breakCondition.keyword)) {
        run.status = 'completed'
        return { acted: false, round: run.currentRound }
      }
    }

    const response = await complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${action.prompt}\n\nContext:\n${context}` },
      ],
      { agentId: run.agentId, workspaceId: run.workspaceId, tier: action.tier, taskType: 'sop-execution' },
    )

    // Validate output if schema defined
    let instructContent: string | null = null
    if (action.outputSchema && action.outputSchema.length > 0) {
      try {
        const schema = actionNodeToZodSchema(action.outputSchema)
        const validated = repairAndParse(response.text, schema)
        instructContent = JSON.stringify(validated)
      } catch (err) {
        logger.warn({ err, roleId: role.id, action: action.type }, 'SOP output validation failed, storing raw')
      }
    }

    // Publish result message
    const msgId = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO sop_messages (id, workflow_run_id, content, instruct_content, cause_by, sent_from, send_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '__all__', ?)`
    ).run(msgId, run.id, response.text, instructContent, action.type, role.id, now)

    // Update role state
    const lastMsgId = newMessages[newMessages.length - 1].id
    db.prepare(
      `UPDATE sop_role_state SET state = state + 1, is_idle = 0, last_observed_msg_id = ?
       WHERE workflow_run_id = ? AND role_id = ?`
    ).run(lastMsgId, run.id, role.id)

    anyActed = true

    eventBus.broadcast('activity.created' as any, {
      type: 'sop.action.completed',
      runId: run.id,
      roleId: role.id,
      actionType: action.type,
      round: run.currentRound,
    })
  }

  if (!anyActed) {
    run.status = 'completed'
  }

  return { acted: anyActed, round: run.currentRound }
}

/**
 * Run a full workflow until completion or budget exhaustion.
 */
export async function runWorkflow(
  templateName: string,
  userInput: string,
  agentId: number,
  workspaceId: number = 1,
  maxRounds: number = 20,
): Promise<WorkflowRun> {
  const run = startWorkflow(templateName, userInput, agentId, workspaceId, maxRounds)

  while (run.status === 'running') {
    const { acted } = await executeRound(run)
    if (!acted) break
  }

  logger.info({ runId: run.id, status: run.status, rounds: run.currentRound }, 'SOP workflow finished')
  return run
}

/**
 * Get all messages for a workflow run.
 */
export function getWorkflowArtifacts(runId: string): SOPMessage[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM sop_messages WHERE workflow_run_id = ? ORDER BY created_at ASC'
  ).all(runId) as SOPMessage[]
}

/**
 * Get role states for a workflow run.
 */
export function getWorkflowRoleStates(runId: string): SOPRoleState[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM sop_role_state WHERE workflow_run_id = ?'
  ).all(runId) as SOPRoleState[]
}

/**
 * Get available template names.
 */
export function getTemplateNames(): string[] {
  return Object.keys(SOP_TEMPLATES)
}

/**
 * Get a template by name.
 */
export function getTemplate(name: string): SOPTemplate | undefined {
  return SOP_TEMPLATES[name]
}
