import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract tests in the style of background-dispatch-isolation.test.ts:
// the #602 claude-runtime branch has ordering and no-fallback guarantees that
// are structural properties of task-dispatch.ts. These assertions pin them so
// a refactor cannot silently reorder the branch below the gateway/direct
// selection or reintroduce a fallback path.
const source = readFileSync(join(process.cwd(), 'src', 'lib', 'task-dispatch.ts'), 'utf8')

function sliceBetween(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  expect(from, `anchor missing: ${start}`).toBeGreaterThan(-1)
  expect(to, `anchor missing: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('claude runtime dispatch routing (#602)', () => {
  it('selects agent_runtime_type in the dispatch query', () => {
    const dispatchLoop = sliceBetween('export async function dispatchAssignedTasks()', '// Auto-routing:')
    expect(dispatchLoop).toContain('a.runtime_type as agent_runtime_type')
  })

  it('routes claude-runtime agents before the gateway/direct selection', () => {
    const dispatchLoop = sliceBetween('export async function dispatchAssignedTasks()', '// Auto-routing:')
    const claudeBranch = dispatchLoop.indexOf("=== 'claude'")
    const directBranch = dispatchLoop.indexOf('useDirectApi && !targetSession')
    expect(claudeBranch).toBeGreaterThan(-1)
    expect(directBranch).toBeGreaterThan(-1)
    expect(claudeBranch).toBeLessThan(directBranch)
    expect(dispatchLoop).toContain('dispatchViaClaudeSession(task, prompt)')
  })

  it('never falls back from the claude session path to another provider', () => {
    const fn = sliceBetween('async function dispatchViaClaudeSession(', 'async function callOpenAICompatible(')
    expect(fn).not.toContain('callDirectly(')
    expect(fn).not.toContain('callClaudeDirectly(')
    expect(fn).not.toContain('callOpenClawGateway')
    expect(fn).toContain('refusing to fall back')
    expect(fn).toContain('ensureClaudeBaseSession')
    expect(fn).toContain('markClaudeBaseSessionMaterialized')
    expect(fn).toContain('auditClaudeSessionDispatch')
  })

  it('creates with --session-id and forks with --resume --fork-session', () => {
    const fn = sliceBetween('async function callClaudeViaCli(', 'async function dispatchViaClaudeSession(')
    expect(fn).toContain("args.push('--session-id', session.create)")
    expect(fn).toContain("args.push('--resume', session.resume, '--fork-session')")
  })

  it('bounds claude CLI output', () => {
    const fn = sliceBetween('const CLAUDE_CLI_MAX_OUTPUT_BYTES', 'async function dispatchViaClaudeSession(')
    expect(fn).toContain('CLAUDE_CLI_MAX_OUTPUT_BYTES = 1_000_000')
    expect(fn).toContain('output exceeded')
  })
})
