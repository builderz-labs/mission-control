import { afterEach, describe, it, expect, vi } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import reviewer from '../../../scripts/pr-reviewer.cjs'

const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/pr-reviewer.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const nodeRequire = createRequire(import.meta.url)

function runScript(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: 30000,
  })
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.doUnmock('node:child_process')
})

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses --repo and --pr', () => {
    const args = reviewer.parseArgs(['--repo', 'owner/repo', '--pr', '42'])
    expect(args.repo).toBe('owner/repo')
    expect(args.pr).toBe(42)
    expect(args.postComment).toBe(false)
    expect(args.merge).toBe(false)
    expect(args.autoMerge).toBe(false)
  })

  it('parses --post-comment flag', () => {
    const args = reviewer.parseArgs(['--repo', 'x/y', '--pr', '1', '--post-comment'])
    expect(args.postComment).toBe(true)
  })

  it('parses --merge flag', () => {
    const args = reviewer.parseArgs(['--merge'])
    expect(args.merge).toBe(true)
  })

  it('parses --auto-merge flag', () => {
    const args = reviewer.parseArgs(['--auto-merge'])
    expect(args.autoMerge).toBe(true)
  })

  it('returns null repo and pr when omitted', () => {
    const args = reviewer.parseArgs([])
    expect(args.repo).toBeNull()
    expect(args.pr).toBeNull()
  })

  it('parses --skip-validation flag', () => {
    const args = reviewer.parseArgs(['--skip-validation'])
    expect(args.skipValidation).toBe(true)
  })
})

// ── checkMergeRefusal ─────────────────────────────────────────────────────────

describe('checkMergeRefusal', () => {
  it('refuses --merge', () => {
    const result = reviewer.checkMergeRefusal({ merge: true, autoMerge: false } as ReturnType<typeof reviewer.parseArgs>)
    expect(result.refused).toBe(true)
    expect(result.flag).toBe('--merge')
  })

  it('refuses --auto-merge', () => {
    const result = reviewer.checkMergeRefusal({ merge: false, autoMerge: true } as ReturnType<typeof reviewer.parseArgs>)
    expect(result.refused).toBe(true)
    expect(result.flag).toBe('--auto-merge')
  })

  it('allows normal review invocation', () => {
    const result = reviewer.checkMergeRefusal({ merge: false, autoMerge: false } as ReturnType<typeof reviewer.parseArgs>)
    expect(result.refused).toBe(false)
    expect(result.flag).toBeNull()
  })
})

// ── classifyFile ──────────────────────────────────────────────────────────────

describe('classifyFile', () => {
  it('classifies scripts as high risk', () => {
    expect(reviewer.classifyFile('scripts/pr-reviewer.cjs').risk).toBe('high')
    expect(reviewer.classifyFile('scripts/mc-coordinator.cjs').risk).toBe('high')
  })

  it('classifies API routes as high risk', () => {
    expect(reviewer.classifyFile('src/app/api/agents/route.ts').risk).toBe('high')
    expect(reviewer.classifyFile('src/app/api/bots/passive-income/route.ts').risk).toBe('high')
  })

  it('classifies package.json as high risk', () => {
    expect(reviewer.classifyFile('package.json').risk).toBe('high')
    expect(reviewer.classifyFile('pnpm-lock.yaml').risk).toBe('high')
  })

  it('classifies agent registry as high risk', () => {
    expect(reviewer.classifyFile('data/mission-control/agent-registry.json').risk).toBe('high')
  })

  it('classifies src/lib as medium risk', () => {
    expect(reviewer.classifyFile('src/lib/db.ts').risk).toBe('medium')
    expect(reviewer.classifyFile('src/lib/agent-coordination.ts').risk).toBe('medium')
  })

  it('classifies components as low risk', () => {
    expect(reviewer.classifyFile('src/components/AgentCard.tsx').risk).toBe('low')
  })

  it('classifies test files as low risk', () => {
    expect(reviewer.classifyFile('src/lib/__tests__/auth.test.ts').risk).toBe('low')
  })

  it('classifies docs as low risk', () => {
    expect(reviewer.classifyFile('docs/mission-control/AGENT_REGISTRY.md').risk).toBe('low')
    expect(reviewer.classifyFile('README.md').risk).toBe('low')
  })

  it('classifies unknown files as low risk', () => {
    expect(reviewer.classifyFile('some/random/file.txt').risk).toBe('low')
  })
})

// ── isStrictZone ──────────────────────────────────────────────────────────────

describe('isStrictZone', () => {
  it('marks scripts as strict zone', () => {
    expect(reviewer.isStrictZone('scripts/mc-execute.cjs')).toBe(true)
  })

  it('marks API routes as strict zone', () => {
    expect(reviewer.isStrictZone('src/app/api/exec-approvals/route.ts')).toBe(true)
  })

  it('marks execution/gate/approval files as strict zone', () => {
    expect(reviewer.isStrictZone('src/lib/execution-gate.ts')).toBe(true)
    expect(reviewer.isStrictZone('src/lib/exec-approval-utils.ts')).toBe(true)
  })

  it('does not mark docs as strict zone', () => {
    expect(reviewer.isStrictZone('docs/mission-control/AGENT_REGISTRY.md')).toBe(false)
  })

  it('does not mark components as strict zone', () => {
    expect(reviewer.isStrictZone('src/components/AgentCard.tsx')).toBe(false)
  })
})

// ── scanRedFlags ──────────────────────────────────────────────────────────────

describe('fetchPrDiffViaGit', () => {
  it('diffs fetched commit SHAs when fetch only updates FETCH_HEAD', async () => {
    const spawnSyncMock = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'base-sha\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'head-sha\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'diff --git a/file b/file\n+change\n', stderr: '' })

    const cjsModule = { exports: {} as Record<string, unknown> }
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8').replace(/^#!.*\r?\n/, '')
    const requireForTest = (id: string) => (id === 'node:child_process' ? { spawnSync: spawnSyncMock } : nodeRequire(id))

    vm.runInNewContext(source, {
      module: cjsModule,
      exports: cjsModule.exports,
      require: requireForTest,
      __filename: SCRIPT_PATH,
      __dirname: path.dirname(SCRIPT_PATH),
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
    }, { filename: SCRIPT_PATH })

    const freshReviewer = cjsModule.exports as typeof reviewer
    const diff = freshReviewer.fetchPrDiffViaGit('base-branch', 'head-branch')

    expect(diff).toContain('diff --git')
    expect(spawnSyncMock.mock.calls).toEqual([
      ['git', ['fetch', 'origin', 'base-branch'], expect.any(Object)],
      ['git', ['rev-parse', 'FETCH_HEAD'], expect.any(Object)],
      ['git', ['fetch', 'origin', 'head-branch'], expect.any(Object)],
      ['git', ['rev-parse', 'FETCH_HEAD'], expect.any(Object)],
      ['git', ['diff', 'base-sha...head-sha'], expect.any(Object)],
    ])
  })

  it('falls back to direct commit diff when triple-dot diff has no merge base', () => {
    const spawnSyncMock = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'base-sha\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'head-sha\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'fatal: no merge base' })
      .mockReturnValueOnce({ status: 0, stdout: 'diff --git a/file b/file\n+change\n', stderr: '' })

    const cjsModule = { exports: {} as Record<string, unknown> }
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8').replace(/^#!.*\r?\n/, '')
    const requireForTest = (id: string) => (id === 'node:child_process' ? { spawnSync: spawnSyncMock } : nodeRequire(id))

    vm.runInNewContext(source, {
      module: cjsModule,
      exports: cjsModule.exports,
      require: requireForTest,
      __filename: SCRIPT_PATH,
      __dirname: path.dirname(SCRIPT_PATH),
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
    }, { filename: SCRIPT_PATH })

    const freshReviewer = cjsModule.exports as typeof reviewer
    const diff = freshReviewer.fetchPrDiffViaGit('base-branch', 'head-branch')

    expect(diff).toContain('diff --git')
    expect(spawnSyncMock.mock.calls).toEqual([
      ['git', ['fetch', 'origin', 'base-branch'], expect.any(Object)],
      ['git', ['rev-parse', 'FETCH_HEAD'], expect.any(Object)],
      ['git', ['fetch', 'origin', 'head-branch'], expect.any(Object)],
      ['git', ['rev-parse', 'FETCH_HEAD'], expect.any(Object)],
      ['git', ['diff', 'base-sha...head-sha'], expect.any(Object)],
      ['git', ['diff', 'base-sha', 'head-sha'], expect.any(Object)],
    ])
  })
})

function makeDiff(filePath: string, lines: string[]): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,0 +1,' + String(lines.length) + ' @@',
    ...lines.map((line) => `+${line}`),
  ].join('\n')
}

function makeRemovalDiff(filePath: string, lines: string[]): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,' + String(lines.length) + ' +1,0 @@',
    ...lines.map((line) => `-${line}`),
  ].join('\n')
}

describe('scanRedFlags', () => {
  it('returns diff-unavailable flag for null diff', () => {
    const flags = reviewer.scanRedFlags(null)
    expect(flags).toHaveLength(1)
    expect(flags[0].flag).toBe('diff-unavailable')
    expect(flags[0].severity).toBe('critical')
    expect(flags[0].production_impact).toBe(true)
  })

  it('diff-unavailable flag has blocking message', () => {
    const flags = reviewer.scanRedFlags(null)
    const flag = flags.find((f: any) => f.flag === 'diff-unavailable') as { flag: string; severity: string; message?: string } | undefined
    expect(flag).toBeDefined()
    expect(flag?.message).toContain('diff could not be inspected')
  })

  it('diff-unavailable flag is also returned for empty string diff', () => {
    const flags = reviewer.scanRedFlags('')
    expect(flags.some((f: { flag: string }) => f.flag === 'diff-unavailable')).toBe(true)
  })

  it('returns empty array for clean diff', () => {
    const diff = [
      'diff --git a/src/lib/utils.ts b/src/lib/utils.ts',
      '--- a/src/lib/utils.ts',
      '+++ b/src/lib/utils.ts',
      '@@ -1,0 +1,1 @@',
      '+export function add(a: number, b: number) { return a + b; }',
    ].join('\n')
    expect(reviewer.scanRedFlags(diff)).toEqual([])
  })

  it('detects dynamic execution (eval)', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ['  const result = eval(userInput);'])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'dynamic-execution')
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('critical')
    expect(flag?.path).toBe('src/app/api/example/route.ts')
    expect(flag?.context_type).toBe('production')
    expect(flag?.production_impact).toBe(true)
  })

  it('detects new Function', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ['  const fn = new Function("return " + code);'])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'dynamic-execution')).toBe(true)
  })

  it('detects auth bypass', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ['  if (skipAuth) { return next(); }'])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'auth-bypass')).toBe(true)
    expect(flags.find((f) => f.flag === 'auth-bypass')?.severity).toBe('critical')
  })

  it('detects approval bypass', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ['  const skipApproval = true;'])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'approval-bypass')).toBe(true)
  })

  it('detects filesystem mutation', () => {
    const diff = makeDiff('scripts/example.cjs', ['  fs.unlinkSync(tempFile);'])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'filesystem-mutation')).toBe(true)
    expect(flags.find((f) => f.flag === 'filesystem-mutation')?.severity).toBe('high')
  })

  it('detects shell execution', () => {
    const diff = makeDiff('scripts/example.cjs', ["  const out = execSync('rm -rf /tmp/x');"])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'shell-execution')).toBe(true)
  })

  it('detects secrets in code', () => {
    const diff = makeDiff('src/lib/example.ts', ['  const API_KEY = "sk-proj-abcdefghijklmn";'])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'secrets-in-code')).toBe(true)
    expect(flags.find((f) => f.flag === 'secrets-in-code')?.severity).toBe('critical')
  })

  it('detects removed test assertions (it/describe blocks)', () => {
    const diff = makeRemovalDiff('src/lib/__tests__/example.test.ts', [
      "  it('verifies login works', () => {",
      '    expect(isLoggedIn()).toBe(true);',
      '  })',
    ])
    const flags = reviewer.scanRedFlags(diff)
    expect(flags.some((f) => f.flag === 'tests-removed')).toBe(true)
    expect(flags.find((f) => f.flag === 'tests-removed')?.severity).toBe('medium')
  })

  it('does not flag removed lines for exec/auth patterns', () => {
    const diff = makeRemovalDiff('src/app/api/example/route.ts', ['  const result = eval(oldCode);'])
    const flags = reviewer.scanRedFlags(diff)
    // Removed eval line should NOT trigger (only added lines count for non-test-removed patterns)
    expect(flags.some((f) => f.flag === 'dynamic-execution')).toBe(false)
  })

  it('includes path, line, context, and excerpt in findings', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ['  const bad = eval(x);'])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'dynamic-execution')
    expect(flag?.path).toBe('src/app/api/example/route.ts')
    expect(flag?.line).toBe(1)
    expect(flag?.context_type).toBe('production')
    expect(flag?.production_impact).toBe(true)
    expect(flag?.message).toContain('production code')
    expect(flag?.excerpt).toContain('eval')
  })

  it('marks detector patterns inside reviewer self file as non-production findings', () => {
    const diff = makeDiff('scripts/pr-reviewer.cjs', ['  pattern: /skipAuth|bypass[_\\s-]?auth/i,'])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'auth-bypass')
    expect(flag).toBeDefined()
    expect(flag?.context_type).toBe('tooling/reviewer-self')
    expect(flag?.production_impact).toBe(false)
  })

  it('marks dangerous test fixtures as non-production findings', () => {
    const diff = makeDiff('src/lib/__tests__/pr-reviewer-bot.test.ts', ["  const out = execSync('rm -rf /tmp/x');"])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.context_type).toBe('test')
    expect(flag?.production_impact).toBe(false)
  })

  it('marks docs examples as non-production findings', () => {
    const diff = makeDiff('docs/mission-control/pr-reviewer-bot.md', ['- `execSync("rm -rf /tmp/x")`'])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.context_type).toBe('docs')
    expect(flag?.production_impact).toBe(false)
  })

  it('allowlists bounded local preflight spawnSync usage', () => {
    const diff = [
      'diff --git a/scripts/mission-control-preflight.cjs b/scripts/mission-control-preflight.cjs',
      '--- a/scripts/mission-control-preflight.cjs',
      '+++ b/scripts/mission-control-preflight.cjs',
      '@@ -1,0 +1,9 @@',
      '+function defaultRunCommand(command, args, cwd) {',
      '+  for (const candidate of commandCandidates(command)) {',
      '+    const result = spawnSync(candidate, args, {',
      "+      stdio: ['ignore', 'pipe', 'pipe'],",
      '+      shell: useShellForCandidate(candidate),',
      '+      windowsHide: true,',
      '+      timeout: 5000,',
      '+    })',
      '+  }',
    ].join('\n')
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(true)
    expect(flag?.allow_reason).toContain('controlled command candidate list')
    expect(flag?.production_impact).toBe(false)
    expect(flag?.requires_human_review).toBe(false)
  })

  it('allowlists bounded local mc-coordinator spawnSync usage', () => {
    const diff = [
      'diff --git a/scripts/mc-coordinator.cjs b/scripts/mc-coordinator.cjs',
      '--- a/scripts/mc-coordinator.cjs',
      '+++ b/scripts/mc-coordinator.cjs',
      '@@ -1,0 +1,10 @@',
      "+if (executeRequested && preflightResult.status !== 'FAIL') {",
      "+  const executeResult = spawnSync('node', [path.join(__dirname, 'mc-execute.cjs'), '--apply-approved'], {",
      '+    env: { ...process.env, MC_LOG_DIR: LOG_DIR },',
      "+    stdio: ['pipe', 'pipe', 'pipe'],",
      '+    timeout: 30000,',
      '+  })',
      '+}',
    ].join('\n')
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(true)
    expect(flag?.allow_reason).toContain('mc-execute')
    expect(flag?.production_impact).toBe(false)
  })

  it('allowlists mc-coordinator when diff context omits stdio/timeout but the guarded local pattern is present', () => {
    const diff = [
      'diff --git a/scripts/mc-coordinator.cjs b/scripts/mc-coordinator.cjs',
      '--- a/scripts/mc-coordinator.cjs',
      '+++ b/scripts/mc-coordinator.cjs',
      '@@ -1,0 +1,8 @@',
      '+const executeRequested = process.argv.includes(\'--execute\');',
      "+if (executeRequested && preflightResult.status !== 'FAIL') {",
      "+  const executeResult = spawnSync('node', [path.join(__dirname, 'mc-execute.cjs'), '--apply-approved'], {",
      '+    encoding: \'utf-8\',',
      '+    cwd: ROOT,',
      '+    env: { ...process.env, MC_LOG_DIR: LOG_DIR },',
      '+  })',
      '+}',
    ].join('\n')
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(true)
    expect(flag?.production_impact).toBe(false)
  })

  it('does not allow shell execution in API routes', () => {
    const diff = makeDiff('src/app/api/example/route.ts', ["  const out = spawnSync('node', ['danger'], { stdio: 'pipe', timeout: 5000 });"])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(false)
    expect(flag?.production_impact).toBe(true)
  })

  it('does not allow user-controlled command strings in production scripts', () => {
    const diff = makeDiff('scripts/example.cjs', ['  const out = spawnSync(userCommand, userArgs, { stdio: \'pipe\', timeout: 5000 });'])
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(false)
    expect(flag?.production_impact).toBe(true)
  })

  it('does not allow missing timeout in allowlisted files', () => {
    const diff = [
      'diff --git a/scripts/mc-coordinator.cjs b/scripts/mc-coordinator.cjs',
      '--- a/scripts/mc-coordinator.cjs',
      '+++ b/scripts/mc-coordinator.cjs',
      '@@ -1,0 +1,8 @@',
      "+if (executeRequested && preflightResult.status !== 'FAIL') {",
      "+  const executeResult = spawnSync('node', [path.join(__dirname, 'mc-execute.cjs'), '--apply-approved'], {",
      '+    env: { ...process.env, MC_LOG_DIR: LOG_DIR },',
      "+    stdio: ['pipe', 'pipe', 'pipe'],",
      '+  })',
      '+}',
    ].join('\n')
    const flags = reviewer.scanRedFlags(diff)
    const flag = flags.find((f) => f.flag === 'shell-execution')
    expect(flag).toBeDefined()
    expect(flag?.allowed).toBe(false)
    expect(flag?.production_impact).toBe(true)
  })
})

// ── buildVerdict ──────────────────────────────────────────────────────────────

describe('buildVerdict', () => {
  const passedValidation = {
    passed: true,
    skipped: false,
    steps: [{ step: 'typecheck', passed: true, duration_ms: 1000 }],
  }

  it('returns OK with risk 0 for clean PR', () => {
    const v = reviewer.buildVerdict([], [], passedValidation)
    expect(v.status).toBe('OK')
    expect(v.risk_level).toBe(0)
    expect(v.recommendation).toContain('LGTM')
  })

  it('returns FAIL with risk 3 for critical red flags', () => {
    const flags = [{
      flag: 'dynamic-execution',
      severity: 'critical',
      path: 'src/app/api/example/route.ts',
      line: 10,
      context_type: 'production',
      production_impact: true,
      message: 'dynamic-execution pattern matched in production code',
    }]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.status).toBe('FAIL')
    expect(v.risk_level).toBe(3)
    expect(v.recommendation).toContain('BLOCK')
  })

  it('returns FAIL with risk 2 for production high-severity red flags', () => {
    const flags = [{
      flag: 'filesystem-mutation',
      severity: 'high',
      path: 'scripts/example.cjs',
      line: 4,
      context_type: 'production',
      production_impact: true,
      message: 'filesystem-mutation pattern matched in production code',
    }]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.status).toBe('FAIL')
    expect(v.risk_level).toBe(2)
    expect(v.recommendation).toContain('BLOCK')
  })

  it('returns WARN with risk 1 for high-risk files without production red flags', () => {
    const files = [{ path: 'scripts/foo.cjs', risk: 'high' as const, category: 'scripts', strict_zone: true }]
    const v = reviewer.buildVerdict(files, [], passedValidation)
    expect(v.status).toBe('WARN')
    expect(v.risk_level).toBe(1)
    expect(v.recommendation).toContain('SAFE WITH NOTES')
  })

  it('returns FAIL with risk 3 for failed validation', () => {
    const failedValidation = {
      passed: false,
      skipped: false,
      steps: [{ step: 'typecheck', passed: false, duration_ms: 5000 }],
    }
    const v = reviewer.buildVerdict([], [], failedValidation)
    expect(v.status).toBe('FAIL')
    expect(v.risk_level).toBe(3)
    expect(v.reasons.some((r: string) => r.includes('typecheck'))).toBe(true)
  })

  it('returns WARN with risk 1 for mixed PR with only non-production red flags', () => {
    const flags = [
      {
        flag: 'dynamic-execution',
        severity: 'critical',
        path: 'src/lib/__tests__/pr-reviewer-bot.test.ts',
        line: 22,
        context_type: 'test',
        production_impact: false,
        message: 'dynamic-execution pattern matched in test fixture',
      },
      {
        flag: 'shell-execution',
        severity: 'high',
        path: 'docs/mission-control/pr-reviewer-bot.md',
        line: 11,
        context_type: 'docs',
        production_impact: false,
        message: 'shell-execution pattern matched in documentation/example text',
      },
    ]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.status).toBe('WARN')
    expect(v.risk_level).toBe(1)
    expect(v.recommendation).toContain('SAFE WITH NOTES')
  })

  it('returns WARN with risk 1 for allowlisted local shell execution findings', () => {
    const flags = [{
      flag: 'shell-execution',
      severity: 'high',
      path: 'scripts/mission-control-preflight.cjs',
      line: 10,
      context_type: 'production',
      production_impact: false,
      allowed: true,
      allow_reason: 'bounded local preflight probe over a controlled command candidate list',
      requires_human_review: false,
      message: 'shell-execution matched an allowlisted local Mission Control pattern',
    }]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.status).toBe('WARN')
    expect(v.risk_level).toBe(1)
    expect(v.recommendation).toContain('SAFE WITH NOTES')
  })

  it('critical takes priority over high', () => {
    const flags = [
      { flag: 'dynamic-execution', severity: 'critical', path: 'src/app/api/example/route.ts', line: 10, context_type: 'production', production_impact: true, message: 'x' },
      { flag: 'filesystem-mutation', severity: 'high', path: 'scripts/example.cjs', line: 4, context_type: 'production', production_impact: true, message: 'y' },
    ]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.risk_level).toBe(3)
    expect(v.recommendation).toContain('BLOCK')
  })

  it('includes reasons for each risk factor', () => {
    const flags = [{ flag: 'auth-bypass', severity: 'critical', path: 'src/app/api/example/route.ts', line: 15, context_type: 'production', production_impact: true, message: 'x' }]
    const v = reviewer.buildVerdict([], flags, passedValidation)
    expect(v.reasons.length).toBeGreaterThan(0)
    expect(v.reasons.some((r: string) => r.includes('auth-bypass'))).toBe(true)
  })

  it('diff-unavailable flag causes BLOCK verdict (risk 3)', () => {
    const diffFlags = reviewer.scanRedFlags(null)
    const v = reviewer.buildVerdict([], diffFlags, passedValidation)
    expect(v.status).toBe('FAIL')
    expect(v.risk_level).toBe(3)
    expect(v.recommendation).toContain('BLOCK')
  })

  it('null diff prevents LGTM verdict', () => {
    const diffFlags = reviewer.scanRedFlags(null)
    const v = reviewer.buildVerdict([], diffFlags, passedValidation)
    expect(v.recommendation).not.toContain('LGTM')
  })
})

// ── buildMarkdownComment ──────────────────────────────────────────────────────

describe('buildMarkdownComment', () => {
  const baseReport = {
    agent: 'PR Reviewer Bot v1',
    label: 'OBSERVE ONLY',
    pr: { repo: 'owner/repo', number: 123 },
    pr_meta: {
      number: 123,
      title: 'Add feature X',
      state: 'open',
      author: 'dev',
      additions: 50,
      deletions: 10,
      changedFiles: 3,
      url: 'https://github.com/owner/repo/pull/123',
    },
    file_summary: {
      total: 3,
      files: [
        { path: 'scripts/foo.cjs', risk: 'high', category: 'scripts', strict_zone: true },
        { path: 'src/lib/utils.ts', risk: 'medium', category: 'lib', strict_zone: false },
        { path: 'README.md', risk: 'low', category: 'docs', strict_zone: false },
      ],
      high_risk_count: 1,
      medium_risk_count: 1,
      low_risk_count: 1,
      strict_zone_count: 1,
    },
    red_flags: [],
    validation: {
      passed: true,
      skipped: false,
      steps: [
        { step: 'typecheck', passed: true, duration_ms: 5000 },
        { step: 'test', passed: true, duration_ms: 45000 },
      ],
    },
    verdict: {
      status: 'WARN',
      risk_level: 1,
      recommendation: 'SAFE WITH NOTES — no production-impacting red flags detected',
      reasons: ['1 high-risk file(s) modified'],
    },
    warnings: ['1 high-risk file(s) modified'],
  }

  it('produces a non-empty markdown string', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(typeof md).toBe('string')
    expect(md.length).toBeGreaterThan(100)
  })

  it('contains the PR title', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('Add feature X')
  })

  it('contains PR number', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('#123')
  })

  it('contains verdict recommendation', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('SAFE WITH NOTES')
  })

  it('contains observe-only disclaimer', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('OBSERVE ONLY')
    expect(md).toContain('no merge capability')
  })

  it('contains validation steps', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('typecheck')
    expect(md).toContain('test')
  })

  it('includes high-risk files section', () => {
    const md = reviewer.buildMarkdownComment(baseReport)
    expect(md).toContain('scripts/foo.cjs')
  })

  it('includes red flags when present', () => {
    const reportWithFlags = {
      ...baseReport,
      red_flags: [{
        flag: 'dynamic-execution',
        severity: 'critical',
        path: 'src/app/api/example/route.ts',
        line: 5,
        context_type: 'production',
        production_impact: true,
        message: 'dynamic-execution pattern matched in production code at src/app/api/example/route.ts:5',
        excerpt: 'const bad = eval(x)',
      }],
    }
    const md = reviewer.buildMarkdownComment(reportWithFlags)
    expect(md).toContain('Production Red Flags')
    expect(md).toContain('dynamic-execution')
    expect(md).toContain('critical')
  })

  it('includes non-production findings in their own section', () => {
    const reportWithFlags = {
      ...baseReport,
      red_flags: [{
        flag: 'shell-execution',
        severity: 'high',
        path: 'src/lib/__tests__/pr-reviewer-bot.test.ts',
        line: 5,
        context_type: 'test',
        production_impact: false,
        message: 'shell-execution pattern matched in test fixture',
        excerpt: "const out = execSync('rm -rf /tmp/x')",
      }],
    }
    const md = reviewer.buildMarkdownComment(reportWithFlags)
    expect(md).toContain('Non-production/Test Fixture Findings')
    expect(md).toContain('src/lib/__tests__/pr-reviewer-bot.test.ts:5')
    expect(md).toContain('test')
  })

  it('includes allowlisted local execution findings in their own section', () => {
    const reportWithFlags = {
      ...baseReport,
      red_flags: [{
        flag: 'shell-execution',
        severity: 'high',
        path: 'scripts/mission-control-preflight.cjs',
        line: 35,
        context_type: 'production',
        production_impact: false,
        allowed: true,
        allow_reason: 'bounded local preflight probe over a controlled command candidate list',
        requires_human_review: false,
        message: 'shell-execution matched an allowlisted local Mission Control pattern',
        excerpt: "const result = spawnSync(candidate, args, {",
      }],
    }
    const md = reviewer.buildMarkdownComment(reportWithFlags)
    expect(md).toContain('Allowed Local Command Execution Findings')
    expect(md).toContain('controlled command candidate list')
    expect(md).toContain('scripts/mission-control-preflight.cjs:35')
  })

  it('handles missing pr_meta gracefully', () => {
    const report = { ...baseReport, pr_meta: null }
    expect(() => reviewer.buildMarkdownComment(report)).not.toThrow()
    const md = reviewer.buildMarkdownComment(report)
    expect(md).toContain('metadata unavailable')
  })

  it('shows INCOMPLETE REVIEW warning when diff-unavailable flag present', () => {
    const diffFlags = reviewer.scanRedFlags(null)
    const report = {
      ...baseReport,
      red_flags: diffFlags,
      verdict: {
        status: 'FAIL',
        risk_level: 3,
        recommendation: 'BLOCK — insufficient data, diff inspection failed',
        reasons: ['1 critical red flag(s): diff-unavailable'],
      },
    }
    const md = reviewer.buildMarkdownComment(report)
    expect(md).toContain('INCOMPLETE REVIEW')
    expect(md).toContain('diff')
    expect(md).not.toContain('LGTM')
  })

  it('does not show INCOMPLETE REVIEW warning when diff was available', () => {
    const report = { ...baseReport, red_flags: [] }
    const md = reviewer.buildMarkdownComment(report)
    expect(md).not.toContain('INCOMPLETE REVIEW')
  })

  it('diff-unavailable flag appears in Red Flags section with message', () => {
    const diffFlags = reviewer.scanRedFlags(null)
    const report = {
      ...baseReport,
      red_flags: diffFlags,
      verdict: {
        status: 'FAIL',
        risk_level: 3,
        recommendation: 'BLOCK — insufficient data, diff inspection failed',
        reasons: ['1 critical red flag(s): diff-unavailable'],
      },
    }
    const md = reviewer.buildMarkdownComment(report)
    expect(md).toContain('diff-unavailable')
    expect(md).toContain('red-flag scan is incomplete')
  })
})

// ── resolveCommentPost (unauthenticated fallback) ─────────────────────────────

describe('resolveCommentPost — unauthenticated fallback', () => {
  it('returns posted:false with reason when not authenticated', () => {
    const result = reviewer.resolveCommentPost('owner/repo', 1, 'comment text', false) as { posted: boolean; reason: string }
    expect(result.posted).toBe(false)
    expect(typeof result.reason).toBe('string')
    expect(result.reason).toContain('not authenticated')
  })

  it('does not throw when gh is unavailable', () => {
    expect(() => reviewer.resolveCommentPost('owner/repo', 1, 'comment', false)).not.toThrow()
  })
})

// ── CLI — auto-merge refusal ──────────────────────────────────────────────────

describe('CLI — auto-merge refusal', () => {
  it('exits 1 when --merge is passed', () => {
    const { status, stdout } = runScript(['--repo', 'owner/repo', '--pr', '1', '--merge'])
    expect(status).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.label).toBe('OBSERVE ONLY')
    expect(parsed.error).toContain('REFUSED')
    expect(parsed.error).toContain('--merge')
    expect(parsed.safety.merge_capable).toBe(false)
  })

  it('exits 1 when --auto-merge is passed', () => {
    const { status, stdout } = runScript(['--repo', 'owner/repo', '--pr', '1', '--auto-merge'])
    expect(status).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.error).toContain('REFUSED')
    expect(parsed.error).toContain('--auto-merge')
  })

  it('merge refusal output is valid JSON', () => {
    const { stdout } = runScript(['--merge'])
    expect(() => JSON.parse(stdout)).not.toThrow()
  })
})

// ── CLI — missing args ────────────────────────────────────────────────────────

describe('CLI — missing args', () => {
  it('exits 1 with valid JSON when no args given', () => {
    const { status, stdout } = runScript([])
    expect(status).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.label).toBe('OBSERVE ONLY')
    expect(parsed.error).toContain('Missing required arguments')
  })

  it('exits 1 when --pr is missing', () => {
    const { status, stdout } = runScript(['--repo', 'owner/repo'])
    expect(status).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.error).toContain('Missing required arguments')
  })

  it('exits 1 when --repo is missing', () => {
    const { status, stdout } = runScript(['--pr', '1'])
    expect(status).toBe(1)
  })
})

// ── CLI — required output shape ───────────────────────────────────────────────

describe('CLI — output shape on error cases', () => {
  it('always includes agent, label, status, risk_level, timestamp, safety', () => {
    const cases = [
      ['--merge'],
      [],
      ['--repo', 'owner/repo', '--pr', '1', '--auto-merge'],
    ]
    for (const args of cases) {
      const { stdout } = runScript(args)
      const parsed = JSON.parse(stdout)
      expect(parsed).toHaveProperty('agent', 'PR Reviewer Bot v1')
      expect(parsed).toHaveProperty('label', 'OBSERVE ONLY')
      expect(parsed).toHaveProperty('status')
      expect(parsed).toHaveProperty('risk_level')
      expect(parsed).toHaveProperty('timestamp')
      expect(parsed.safety?.merge_capable).toBe(false)
    }
  })
})
