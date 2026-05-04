/**
 * Command Contract v1 — structural registry for all commands entering the gate.
 *
 * Defines which commands are known to the system and what arguments they accept.
 * Does NOT decide whether a command is safe or permitted for a given agent —
 * that is the responsibility of the coordination layer (blocked_commands,
 * allowed_commands, mode). Unknown commands (not in the registry at all) are
 * rejected here before reaching the gate. Known but risky commands pass through
 * and are governed by per-agent coordination rules.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandCategory = 'git' | 'node' | 'pnpm' | 'shell'

export type CommandIntent =
  | 'read'
  | 'write'
  | 'history_rewrite'
  | 'filesystem_delete'
  | 'network_request'
  | 'process_execution'
  | 'package_management'

export type CommandRiskProfile = 'low' | 'medium' | 'high'

export interface Command {
  id: string
  category: CommandCategory
  intent: CommandIntent
  risk_profile: CommandRiskProfile
  /** Extra arguments provided after the base command string. */
  args: string[]
}

export interface CommandValidation {
  valid: boolean
  reason: string
  /** Only present when valid === true. */
  command?: Command
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface CommandDef {
  id: string
  category: CommandCategory
  intent: CommandIntent
  risk_profile: CommandRiskProfile
  /**
   * null  — any extra args are permitted (subject to arg_guards below).
   * []    — no extra args permitted.
   * [...] — only these specific args are permitted.
   */
  allowed_args: string[] | null
  /**
   * Optional per-command argument guards for free-form commands (allowed_args: null).
   * Each guard receives the parsed arg list and returns an error string or null.
   * Guards run after the allowed_args check, before the command is accepted.
   */
  arg_guards?: ReadonlyArray<(args: string[]) => string | null>
}

const COMMAND_REGISTRY: Record<string, CommandDef> = {
  'git status': {
    id: 'git:status',
    category: 'git',
    intent: 'read',
    risk_profile: 'low',
    allowed_args: [],
  },
  'git log': {
    id: 'git:log',
    category: 'git',
    intent: 'read',
    risk_profile: 'low',
    allowed_args: null,
  },
  'git diff': {
    id: 'git:diff',
    category: 'git',
    intent: 'read',
    risk_profile: 'low',
    allowed_args: null,
  },
  'pnpm skills:intake': {
    id: 'pnpm:skills-intake',
    category: 'pnpm',
    intent: 'package_management',
    risk_profile: 'medium',
    allowed_args: [],
  },
  'node scripts/systems-curator.cjs': {
    id: 'node:systems-curator',
    category: 'node',
    intent: 'process_execution',
    risk_profile: 'low',
    allowed_args: [],
  },
  'node scripts/mc-coordinator.cjs': {
    id: 'node:mc-coordinator',
    category: 'node',
    intent: 'process_execution',
    risk_profile: 'low',
    allowed_args: [],
  },
  'node scripts/passive-income-bot.cjs': {
    id: 'node:passive-income-bot',
    category: 'node',
    intent: 'process_execution',
    risk_profile: 'medium',
    allowed_args: [],
  },
  // The entries below are structurally known commands. Whether a specific agent
  // may run them is determined by coordination rules, not by this registry.
  'git push': {
    id: 'git:push',
    category: 'git',
    intent: 'write',
    risk_profile: 'medium',
    allowed_args: null,
  },
  'git reset': {
    id: 'git:reset',
    category: 'git',
    intent: 'history_rewrite',
    risk_profile: 'high',
    allowed_args: null,
    arg_guards: [
      (args) => args.includes('--hard')
        ? 'Argument "--hard" is blocked for git reset — use "--soft" or "--mixed" instead.'
        : null,
    ],
  },
  'git clean': {
    id: 'git:clean',
    category: 'git',
    intent: 'filesystem_delete',
    risk_profile: 'high',
    allowed_args: null,
  },
  'curl': {
    id: 'shell:curl',
    category: 'shell',
    intent: 'network_request',
    risk_profile: 'medium',
    allowed_args: null,
    arg_guards: [
      (args) => args.some(a => a.startsWith('http://'))
        ? 'Non-HTTPS URLs are blocked for curl — use https:// instead.'
        : null,
    ],
  },
  'wget': {
    id: 'shell:wget',
    category: 'shell',
    intent: 'network_request',
    risk_profile: 'medium',
    allowed_args: null,
  },
  'rm': {
    id: 'shell:rm',
    category: 'shell',
    intent: 'filesystem_delete',
    risk_profile: 'high',
    allowed_args: null,
    arg_guards: [
      (args) => args.includes('--no-preserve-root')
        ? 'Argument "--no-preserve-root" is blocked for rm.'
        : null,
      (args) => args.includes('/')
        ? 'Argument "/" is blocked for rm — root deletion is not permitted.'
        : null,
    ],
  },
  'unlink': {
    id: 'shell:unlink',
    category: 'shell',
    intent: 'filesystem_delete',
    risk_profile: 'medium',
    allowed_args: null,
  },
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function validateCommand(raw: string): CommandValidation {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { valid: false, reason: 'Command must not be empty.' }
  }

  const entry = Object.entries(COMMAND_REGISTRY).find(
    ([base]) => trimmed === base || trimmed.startsWith(base + ' '),
  )

  if (!entry) {
    return {
      valid: false,
      reason: `Unknown command "${trimmed}" — not in command registry.`,
    }
  }

  const [base, def] = entry
  const extra = trimmed.slice(base.length).trim()
  const args = extra ? extra.split(/\s+/) : []

  // No extra args allowed
  if (def.allowed_args !== null && def.allowed_args.length === 0 && args.length > 0) {
    return {
      valid: false,
      reason: `Command "${base}" does not accept extra arguments (got: ${args.join(' ')}).`,
    }
  }

  // Specific allowed args: reject anything outside the list
  if (def.allowed_args !== null && def.allowed_args.length > 0) {
    const disallowed = args.filter(a => !def.allowed_args!.includes(a))
    if (disallowed.length > 0) {
      return {
        valid: false,
        reason: `Command "${base}" received disallowed argument(s): ${disallowed.join(', ')}.`,
      }
    }
  }

  // Per-command argument guards (run for free-form and specific-arg commands alike)
  if (def.arg_guards) {
    for (const guard of def.arg_guards) {
      const err = guard(args)
      if (err !== null) {
        return { valid: false, reason: err }
      }
    }
  }

  return {
    valid: true,
    reason: 'Command is valid.',
    command: { id: def.id, category: def.category, intent: def.intent, risk_profile: def.risk_profile, args },
  }
}

/** Returns the list of base command strings registered in the contract. */
export function listRegisteredCommands(): string[] {
  return Object.keys(COMMAND_REGISTRY)
}
