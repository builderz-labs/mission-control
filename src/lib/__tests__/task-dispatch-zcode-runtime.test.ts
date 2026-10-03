import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { __testables, resolveCliSandboxOptions } from '@/lib/task-dispatch'

const { parseTrailingJsonObject, buildZcodeDispatchArgs, zcodePermissionMode } = __testables

const SESSION = 'sess_33333333-3333-4333-8333-333333333333'

function taskPatch(overrides: Record<string, unknown> = {}): any {
  return {
    id: 7,
    title: 'Ship the adapter',
    description: null,
    status: 'assigned',
    priority: 'high',
    assigned_to: 'zcode-agent',
    workspace_id: 1,
    agent_name: 'zcode-agent',
    agent_id: 3,
    agent_config: null,
    metadata: null,
    ticket_prefix: null,
    project_ticket_no: null,
    project_id: null,
    ...overrides,
  }
}

describe('parseTrailingJsonObject', () => {
  it('parses a bare JSON payload', () => {
    expect(parseTrailingJsonObject('{"sessionId":"s","response":"ok"}')).toEqual({ sessionId: 's', response: 'ok' })
  })

  it('finds the payload after unrelated CLI noise', () => {
    const stdout = `ZCode Built-in missing\nsome log line\n${'{"sessionId":"' + SESSION + '","response":"ok","usage":{"inputTokens":1}}'}`
    const parsed = parseTrailingJsonObject(stdout)
    expect(parsed?.sessionId).toBe(SESSION)
    expect(parsed?.usage).toEqual({ inputTokens: 1 })
  })

  it('takes the last object when the stream contains several', () => {
    const parsed = parseTrailingJsonObject('{"response":"first"}\nprogress {"partial":true}\n{"response":"last"}')
    expect(parsed).toEqual({ response: 'last' })
  })

  it('returns null instead of inventing a result', () => {
    expect(parseTrailingJsonObject('')).toBeNull()
    expect(parseTrailingJsonObject('prose only, no payload')).toBeNull()
  })
})

describe('buildZcodeDispatchArgs', () => {
  it('requests machine-readable output and a bounded permission mode', () => {
    const args = buildZcodeDispatchArgs(taskPatch(), 'do the thing', resolveCliSandboxOptions(taskPatch()))
    expect(args.slice(0, 2)).toEqual(['--json', '--mode'])
    expect(args).toContain('build')
    expect(args[args.length - 2]).toBe('-p')
    expect(args[args.length - 1]).toBe('do the thing')
  })

  it('resumes the agent base session and scopes the working directory', () => {
    const args = buildZcodeDispatchArgs(
      taskPatch(),
      'p',
      { allowedTools: null, maxBudgetUsd: null, cwd: '/srv/work/project' },
      { resume: SESSION },
    )
    expect(args[args.indexOf('--resume') + 1]).toBe(SESSION)
    expect(args[args.indexOf('--cwd') + 1]).toBe('/srv/work/project')
  })

  it('honours an explicit permission mode and ignores unknown ones', () => {
    const noSandbox = { allowedTools: null, maxBudgetUsd: null, cwd: null }
    const planned = taskPatch({ metadata: JSON.stringify({ dispatchMode: 'plan' }) })
    expect(zcodePermissionMode(planned)).toBe('plan')
    expect(buildZcodeDispatchArgs(planned, 'p', noSandbox).slice(0, 3)).toEqual(['--json', '--mode', 'plan'])

    const bogus = taskPatch({ agent_config: JSON.stringify({ dispatchMode: 'rm-rf' }) })
    expect(zcodePermissionMode(bogus)).toBe('build')
  })

  it('keeps Claude allowlist and budget flags out of ZCode argv', () => {
    // dispatchAllowedTools / dispatchMaxBudgetUsd drive Claude flags. ZCode has
    // neither an allowlist nor a budget cap, so they must not leak into argv.
    const args = buildZcodeDispatchArgs(
      taskPatch({ metadata: JSON.stringify({ dispatchAllowedTools: ['Read', 'Grep'] }) }),
      'p',
      { allowedTools: ['Read', 'Grep'], maxBudgetUsd: 5, cwd: null },
    )
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--max-budget-usd')
    expect(args).not.toContain('Read')
  })
})

describe('zcode runtime dispatch routing', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'lib', 'task-dispatch.ts'), 'utf8')

  function sliceBetween(start: string, end: string): string {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    expect(from, `anchor missing: ${start}`).toBeGreaterThan(-1)
    expect(to, `anchor missing: ${end}`).toBeGreaterThan(from)
    return source.slice(from, to)
  }

  it('routes zcode-runtime agents before the gateway/direct selection', () => {
    const dispatchLoop = sliceBetween('export async function dispatchAssignedTasks()', '// Auto-routing:')
    const zcodeBranch = dispatchLoop.indexOf("=== 'zcode'")
    const directBranch = dispatchLoop.indexOf('useDirectApi && !targetSession')
    expect(zcodeBranch).toBeGreaterThan(-1)
    expect(zcodeBranch).toBeLessThan(directBranch)
    expect(dispatchLoop).toContain('dispatchViaZcodeSession(task, prompt)')
  })

  it('never falls back from the zcode session path to another provider', () => {
    const fn = sliceBetween('async function dispatchViaZcodeSession(', 'async function callOpenAICompatible(')
    expect(fn).not.toContain('callDirectly(')
    expect(fn).not.toContain('callOpenClawGateway')
    expect(fn).toContain('refusing to fall back')
    expect(fn).toContain('getZcodeBaseSession')
    expect(fn).toContain('saveZcodeBaseSession')
    expect(fn).toContain('auditZcodeSessionDispatch')
  })

  it('treats an unparseable payload as a failed dispatch', () => {
    const fn = sliceBetween('async function callZcodeViaCli(', 'async function dispatchViaZcodeSession(')
    expect(fn).toContain('no JSON payload')
    expect(fn).toContain('ZCODE_CLI_MAX_OUTPUT_BYTES')
    expect(fn).toContain('ZCODE_CLI_MAX_PROMPT_CHARS')
    expect(fn).toContain('recordDispatchTokenUsage')
  })
})
