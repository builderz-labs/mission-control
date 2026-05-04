/**
 * Agent Coordination v1 — observe-first, read-only by default.
 *
 * No autonomous loops. No task spawning. No networking. No mutation without
 * explicit approval. blocked_commands always win over allowed_commands.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = 'ACTIVE' | 'PLANNED' | 'DISABLED'
export type AgentMode = 'OBSERVE_ONLY' | 'APPROVAL_REQUIRED' | 'EXECUTION_ALLOWED'
export type RiskLevel = 0 | 1 | 2 | 3

export interface HandoffSummary {
  decisions_made: string[]
  uncertainty: string[]
  next_action: string
  evidence: string[]
  risk: RiskLevel
}

export interface CoordinatedAgent {
  id: string
  name: string
  status: AgentStatus
  mode: AgentMode
  owner: string
  system_area: string
  allowed_commands: string[]
  blocked_commands: string[]
  dependencies: string[]
  last_run: string | null
  risk_level: RiskLevel
  handoff_summary: HandoffSummary | null
}

export type ValidationOutcome = 'ALLOWED' | 'BLOCKED' | 'WARN'

export interface ValidationResult {
  outcome: ValidationOutcome
  reason: string
  missing_dependencies?: string[]
}

export interface AgentStateSummary {
  total: number
  active: number
  planned: number
  disabled: number
  observe_only: number
  approval_required: number
  execution_allowed: number
  highest_risk: RiskLevel
  overall: 'PASS' | 'WARN' | 'FAIL'
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: CoordinatedAgent[] = [
  {
    id: 'repo-steward',
    name: 'Repo Steward',
    status: 'ACTIVE',
    mode: 'OBSERVE_ONLY',
    owner: 'platform',
    system_area: 'repository',
    allowed_commands: ['git status', 'git log', 'git diff'],
    blocked_commands: ['git push', 'git reset', 'git clean'],
    dependencies: [],
    last_run: null,
    risk_level: 0,
    handoff_summary: null,
  },
  {
    id: 'skill-intake',
    name: 'Skill Intake',
    status: 'ACTIVE',
    mode: 'APPROVAL_REQUIRED',
    owner: 'platform',
    system_area: 'skills',
    allowed_commands: ['pnpm skills:intake'],
    blocked_commands: ['rm', 'unlink'],
    dependencies: ['repo-steward'],
    last_run: null,
    risk_level: 1,
    handoff_summary: null,
  },
  {
    id: 'systems-curator',
    name: 'Systems Curator',
    status: 'ACTIVE',
    mode: 'OBSERVE_ONLY',
    owner: 'platform',
    system_area: 'audit',
    allowed_commands: ['node scripts/systems-curator.cjs'],
    blocked_commands: [],
    dependencies: [],
    last_run: null,
    risk_level: 0,
    handoff_summary: null,
  },
  {
    id: 'mc-coordinator',
    name: 'MC Coordinator',
    status: 'ACTIVE',
    mode: 'OBSERVE_ONLY',
    owner: 'platform',
    system_area: 'coordination',
    allowed_commands: ['node scripts/mc-coordinator.cjs'],
    blocked_commands: [],
    dependencies: ['repo-steward', 'systems-curator'],
    last_run: null,
    risk_level: 1,
    handoff_summary: null,
  },
  {
    id: 'passive-income-bot',
    name: 'Passive Income Bot',
    status: 'ACTIVE',
    mode: 'APPROVAL_REQUIRED',
    owner: 'products',
    system_area: 'bots',
    allowed_commands: ['node scripts/passive-income-bot.cjs'],
    blocked_commands: ['curl', 'fetch', 'wget'],
    dependencies: [],
    last_run: null,
    risk_level: 2,
    handoff_summary: null,
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function listCoordinatedAgents(): CoordinatedAgent[] {
  return REGISTRY.map(a => ({ ...a }))
}

export interface ValidateOptions {
  /** Pass true only when a human-approved execution is confirmed. */
  approved?: boolean
  /** Command the agent intends to run, checked against blocked_commands. */
  command?: string
  /**
   * Pass true to allow an EXECUTION_ALLOWED agent to proceed despite missing
   * dependencies. Has no effect on OBSERVE_ONLY or APPROVAL_REQUIRED agents.
   */
  force?: boolean
}

export function validateAgentForExecution(
  agent: CoordinatedAgent,
  options: ValidateOptions = {},
): ValidationResult {
  // Unknown agents never reach this function, but callers may pass arbitrary
  // objects — guard by checking registry membership.
  const registered = REGISTRY.some(a => a.id === agent.id)
  if (!registered) {
    return { outcome: 'BLOCKED', reason: 'Agent is not in the coordination registry.' }
  }

  if (agent.status === 'PLANNED') {
    return { outcome: 'BLOCKED', reason: 'Agent is PLANNED and not yet eligible for execution.' }
  }
  if (agent.status === 'DISABLED') {
    return { outcome: 'BLOCKED', reason: 'Agent is DISABLED.' }
  }

  // blocked_commands always win
  if (options.command) {
    const cmd = options.command.trim()
    const isBlocked = agent.blocked_commands.some(b => cmd === b || cmd.startsWith(b + ' '))
    if (isBlocked) {
      return { outcome: 'BLOCKED', reason: `Command "${options.command}" is in blocked_commands.` }
    }
  }

  if (agent.mode === 'OBSERVE_ONLY') {
    if (options.command) {
      const allowed = agent.allowed_commands.some(
        a => options.command!.trim() === a || options.command!.trim().startsWith(a + ' '),
      )
      if (!allowed) {
        return {
          outcome: 'BLOCKED',
          reason: 'OBSERVE_ONLY agent may not run commands outside allowed_commands.',
        }
      }
    }
    // Missing deps warn but never block an observe-only agent.
    const missingObs = agent.dependencies.filter(dep => !REGISTRY.some(a => a.id === dep && a.status === 'ACTIVE'))
    if (missingObs.length > 0) {
      return {
        outcome: 'WARN',
        reason: `Missing or inactive dependencies: ${missingObs.join(', ')}.`,
        missing_dependencies: missingObs,
      }
    }
    return { outcome: 'ALLOWED', reason: 'OBSERVE_ONLY agent may report and read.' }
  }

  if (agent.mode === 'APPROVAL_REQUIRED' && !options.approved) {
    return { outcome: 'BLOCKED', reason: 'Agent requires explicit approval before execution.' }
  }

  // Dependency check — mode-aware, evaluated after approval gate.
  const missing = agent.dependencies.filter(dep => !REGISTRY.some(a => a.id === dep && a.status === 'ACTIVE'))
  if (missing.length > 0) {
    if (agent.mode === 'APPROVAL_REQUIRED') {
      // Approval alone does not override missing dependencies.
      return {
        outcome: 'BLOCKED',
        reason: `Missing or inactive dependencies: ${missing.join(', ')}.`,
        missing_dependencies: missing,
      }
    }
    // EXECUTION_ALLOWED: block unless caller explicitly passes { force: true }.
    if (!options.force) {
      return {
        outcome: 'BLOCKED',
        reason: `Missing or inactive dependencies: ${missing.join(', ')}. Pass { force: true } to override.`,
        missing_dependencies: missing,
      }
    }
    return {
      outcome: 'WARN',
      reason: `Proceeding with missing dependencies (forced): ${missing.join(', ')}.`,
      missing_dependencies: missing,
    }
  }

  return { outcome: 'ALLOWED', reason: 'Agent is eligible for execution.' }
}

export function createAgentHandoff(
  agent: CoordinatedAgent,
  result: {
    decisions_made?: string[]
    uncertainty?: string[]
    next_action?: string
    evidence?: string[]
    risk?: RiskLevel
  },
): HandoffSummary {
  return {
    decisions_made: result.decisions_made ?? [],
    uncertainty: result.uncertainty ?? [],
    next_action: result.next_action ?? 'No next action specified.',
    evidence: result.evidence ?? [],
    risk: result.risk ?? agent.risk_level,
  }
}

export function summarizeAgentState(agents: CoordinatedAgent[]): AgentStateSummary {
  const total = agents.length
  const active = agents.filter(a => a.status === 'ACTIVE').length
  const planned = agents.filter(a => a.status === 'PLANNED').length
  const disabled = agents.filter(a => a.status === 'DISABLED').length
  const observe_only = agents.filter(a => a.mode === 'OBSERVE_ONLY').length
  const approval_required = agents.filter(a => a.mode === 'APPROVAL_REQUIRED').length
  const execution_allowed = agents.filter(a => a.mode === 'EXECUTION_ALLOWED').length
  const highest_risk = agents.reduce<RiskLevel>((max, a) => (a.risk_level > max ? a.risk_level : max), 0)

  let overall: 'PASS' | 'WARN' | 'FAIL'
  if (disabled > 0 || highest_risk >= 3) {
    overall = 'FAIL'
  } else if (planned > 0 || highest_risk >= 2) {
    overall = 'WARN'
  } else {
    overall = 'PASS'
  }

  return { total, active, planned, disabled, observe_only, approval_required, execution_allowed, highest_risk, overall }
}

/** Lookup a single agent by id. Returns undefined for unknown agents. */
export function findAgent(id: string): CoordinatedAgent | undefined {
  const found = REGISTRY.find(a => a.id === id)
  return found ? { ...found } : undefined
}
