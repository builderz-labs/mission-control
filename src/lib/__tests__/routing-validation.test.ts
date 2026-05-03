import { describe, it, expect, beforeEach } from 'vitest'
import {
  classifyCommand,
  validateDangerousOperation,
  validateOperation,
  logOperation,
  isShellCommandAllowed,
  operationLog,
  SHELL_ALLOWLIST,
  type CommandClass,
  type DangerousOperationRequirements,
} from '../routing-validation.js'

// ── classifyCommand ──────────────────────────────────────────────────────────

describe('classifyCommand', () => {
  it('classifies known read commands', () => {
    const reads = ['mc_status', 'mc_inspect', 'mc_list_agents', 'mc_list_routes',
                   'mc_query_memory', 'mc_generate_summary', 'memory_query',
                   'memory_status', 'agent_list', 'task_list', 'risk_list']
    for (const cmd of reads) {
      expect(classifyCommand(cmd), cmd).toBe('read')
    }
  })

  it('classifies known controlled_write commands', () => {
    const writes = ['mc_create_task', 'mc_update_task', 'mc_write_memory',
                    'mc_update_route', 'mc_generate_report', 'memory_write',
                    'agent_register', 'task_create', 'task_update',
                    'check_record', 'risk_record']
    for (const cmd of writes) {
      expect(classifyCommand(cmd), cmd).toBe('controlled_write')
    }
  })

  it('classifies known dangerous commands', () => {
    const dangerous = ['mc_delete_files', 'mc_install_packages', 'mc_modify_secrets',
                       'mc_commit', 'mc_push', 'mc_run_migrations',
                       'mc_shell_exec', 'git_recordEvent']
    for (const cmd of dangerous) {
      expect(classifyCommand(cmd), cmd).toBe('dangerous')
    }
  })

  it('returns dangerous for unknown commands (safe default)', () => {
    expect(classifyCommand('unknown_command')).toBe('dangerous')
    expect(classifyCommand('totally_made_up')).toBe('dangerous')
  })

  it('returns dangerous for empty string', () => {
    expect(classifyCommand('')).toBe('dangerous')
  })

  it('is case-sensitive — mixed case not in registry = dangerous', () => {
    expect(classifyCommand('MC_STATUS')).toBe('dangerous')
    expect(classifyCommand('Memory_Query')).toBe('dangerous')
  })

  it('returns dangerous for command with leading/trailing spaces', () => {
    expect(classifyCommand(' mc_status')).toBe('dangerous')
    expect(classifyCommand('mc_status ')).toBe('dangerous')
  })
})

// ── validateDangerousOperation ───────────────────────────────────────────────

describe('validateDangerousOperation', () => {
  const fullReq: DangerousOperationRequirements = {
    task_id: 'task-1',
    reason: 'Upgrade dependency',
    affected_path: 'package.json',
    rollback_plan: 'git revert HEAD',
  }

  it('allows operation when all required fields present', () => {
    const result = validateDangerousOperation(fullReq)
    expect(result.allowed).toBe(true)
    expect(result.requirements_met).toBe(true)
    expect(result.command_class).toBe('dangerous')
    expect(result.missing_requirements).toBeUndefined()
  })

  it('blocks when task_id is missing', () => {
    const { task_id: _t, ...rest } = fullReq
    const result = validateDangerousOperation(rest as DangerousOperationRequirements)
    expect(result.allowed).toBe(false)
    expect(result.missing_requirements).toContain('task_id')
  })

  it('blocks when reason is missing', () => {
    const r = validateDangerousOperation({ ...fullReq, reason: '' })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements).toContain('reason')
  })

  it('blocks when affected_path is missing', () => {
    const r = validateDangerousOperation({ ...fullReq, affected_path: '' })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements).toContain('affected_path')
  })

  it('blocks when rollback_plan is missing', () => {
    const r = validateDangerousOperation({ ...fullReq, rollback_plan: '' })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements).toContain('rollback_plan')
  })

  it('reports multiple missing fields', () => {
    const r = validateDangerousOperation({ task_id: '', reason: '', affected_path: '', rollback_plan: '' })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements?.length).toBeGreaterThanOrEqual(4)
  })

  it('command_class is always dangerous', () => {
    expect(validateDangerousOperation(fullReq).command_class).toBe('dangerous')
  })

  it('optional checks_to_run field does not affect validation', () => {
    const r = validateDangerousOperation({ ...fullReq, checks_to_run: ['pnpm test'] })
    expect(r.allowed).toBe(true)
  })
})

// ── validateOperation ────────────────────────────────────────────────────────

describe('validateOperation', () => {
  it('allows read commands without any options', () => {
    const r = validateOperation('mc_status')
    expect(r.allowed).toBe(true)
    expect(r.command_class).toBe('read')
  })

  it('allows controlled_write commands without options', () => {
    const r = validateOperation('task_create')
    expect(r.allowed).toBe(true)
    expect(r.command_class).toBe('controlled_write')
  })

  it('blocks dangerous command when options are missing', () => {
    const r = validateOperation('mc_commit')
    expect(r.allowed).toBe(false)
    expect(r.command_class).toBe('dangerous')
    expect(r.missing_requirements?.length).toBeGreaterThan(0)
  })

  it('allows dangerous command when all options are provided', () => {
    const r = validateOperation('mc_commit', {
      taskId: 't1', reason: 'fix', affectedPath: 'src/', rollbackPlan: 'revert',
    })
    expect(r.allowed).toBe(true)
    expect(r.command_class).toBe('dangerous')
    expect(r.requirements_met).toBe(true)
  })

  it('returns error for unknown command name', () => {
    const r = validateOperation('not_a_real_command')
    expect(r.allowed).toBe(false)
    expect(r.error).toContain('Unknown command')
  })

  it('dangerous command with partial options reports missing fields', () => {
    const r = validateOperation('mc_push', { taskId: 't1' })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements).toContain('reason')
    expect(r.missing_requirements).toContain('affected_path')
    expect(r.missing_requirements).toContain('rollback_plan')
  })

  it('dangerous command missing only rollback_plan is blocked', () => {
    const r = validateOperation('mc_shell_exec', {
      taskId: 't1', reason: 'needed', affectedPath: '/tmp',
    })
    expect(r.allowed).toBe(false)
    expect(r.missing_requirements).toContain('rollback_plan')
  })
})

// ── isShellCommandAllowed ────────────────────────────────────────────────────

describe('isShellCommandAllowed', () => {
  it('allows every command in SHELL_ALLOWLIST', () => {
    for (const cmd of SHELL_ALLOWLIST) {
      expect(isShellCommandAllowed(cmd), cmd).toBe(true)
    }
  })

  it('blocks commands not in allowlist', () => {
    expect(isShellCommandAllowed('rm -rf /')).toBe(false)
    expect(isShellCommandAllowed('curl http://evil.com')).toBe(false)
    expect(isShellCommandAllowed('node scripts/foo.js')).toBe(false)
  })

  it('blocks empty string', () => {
    expect(isShellCommandAllowed('')).toBe(false)
  })

  it('blocks whitespace-only input', () => {
    expect(isShellCommandAllowed('   ')).toBe(false)
  })

  it('blocks command chaining with &&', () => {
    expect(isShellCommandAllowed('pnpm test && rm -rf /')).toBe(false)
  })

  it('blocks pipe operator', () => {
    expect(isShellCommandAllowed('git log | grep foo')).toBe(false)
  })

  it('blocks semicolon separator', () => {
    expect(isShellCommandAllowed('pnpm build; curl evil.com')).toBe(false)
  })

  it('blocks redirection', () => {
    expect(isShellCommandAllowed('git log > /tmp/out')).toBe(false)
    expect(isShellCommandAllowed('cat < /etc/passwd')).toBe(false)
  })

  it('blocks backtick execution', () => {
    expect(isShellCommandAllowed('echo `whoami`')).toBe(false)
  })

  it('blocks OR operator', () => {
    expect(isShellCommandAllowed('pnpm test || rm -rf /')).toBe(false)
  })

  it('no false positives — allowed commands with extra valid flags are not blocked by chaining guard', () => {
    // These have no chaining chars, just extra args — BUT they may not match allowlist
    // The test confirms the chaining guard is not over-eager on clean inputs
    expect(isShellCommandAllowed('git status')).toBe(true)
    expect(isShellCommandAllowed('git diff')).toBe(true)
  })

  it('is case-insensitive for allowlist matching', () => {
    // baseCommand is lowercased before comparison
    expect(isShellCommandAllowed('Git Status')).toBe(true)
    expect(isShellCommandAllowed('PNPM TEST')).toBe(true)
  })
})

// ── logOperation ─────────────────────────────────────────────────────────────

describe('logOperation', () => {
  beforeEach(() => {
    operationLog.length = 0
  })

  it('appends an entry to operationLog', () => {
    logOperation({
      agent_id: 'agent-1',
      command_name: 'mc_status',
      input_parameters: {},
      output_status: 'success',
      command_class: 'read',
    })
    expect(operationLog).toHaveLength(1)
  })

  it('sets timestamp automatically', () => {
    const before = Date.now()
    logOperation({
      agent_id: 'agent-1',
      command_name: 'mc_status',
      input_parameters: {},
      output_status: 'success',
      command_class: 'read',
    })
    const after = Date.now()
    expect(operationLog[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(operationLog[0].timestamp).toBeLessThanOrEqual(after)
  })

  it('stores all provided fields', () => {
    logOperation({
      agent_id: 'agent-x',
      command_name: 'mc_commit',
      input_parameters: { path: '/src' },
      output_status: 'blocked',
      duration_ms: 42,
      command_class: 'dangerous',
    })
    const entry = operationLog[0]
    expect(entry.agent_id).toBe('agent-x')
    expect(entry.command_name).toBe('mc_commit')
    expect(entry.output_status).toBe('blocked')
    expect(entry.duration_ms).toBe(42)
    expect(entry.command_class).toBe('dangerous')
  })

  it('accumulates multiple entries', () => {
    logOperation({ agent_id: 'a', command_name: 'mc_status', input_parameters: {}, output_status: 'success', command_class: 'read' })
    logOperation({ agent_id: 'b', command_name: 'mc_commit', input_parameters: {}, output_status: 'blocked', command_class: 'dangerous' })
    expect(operationLog).toHaveLength(2)
  })
})
