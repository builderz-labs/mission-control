import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 })),
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
  deny: vi.fn(() => null as unknown),
  pin: vi.fn(async (input: { from: string; to: string }) => ({
    from: input.from,
    to: input.to,
    window: 160000,
    compactRequired: false,
    env: { ADAPTIVE_CONTEXT_POLICY_PATH: '/tmp/policy.json' },
    unsetEnv: ['CLAUDE_CODE_AUTO_COMPACT_WINDOW'],
    argv: ['-c', 'model_auto_compact_token_limit=160000'],
    policyPath: '/tmp/policy.json',
  })),
}))

vi.mock('@/lib/command', () => ({ runCommand: mocks.runCommand }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: mocks.deny,
}))
vi.mock('@/lib/rate-limit', () => ({
  heavyLimiter: vi.fn(() => null),
}))
vi.mock('@/lib/session-transcript-read', () => ({
  readKindTranscript: vi.fn(() => [
    { role: 'assistant', parts: [{ type: 'text', text: 'Next: cover auth.' }] },
    { role: 'system', parts: [{ type: 'artifact', title: 'Register', url: 'https://claude.ai/code/artifact/abc' }] },
  ]),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/adaptive-context-handoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adaptive-context-handoff')>()),
  pinAdaptiveContext: mocks.pin,
}))

import {
  buildHandoffCommand,
  buildHandoffPrompt,
  clipExcerpt,
  isHandoffKind,
  parseSpawnedSessionId,
  resolveSessionCwd,
  runHandoffWithRetry,
  shQuote,
} from '../session-handoff'
import { POST } from '@/app/api/sessions/handoff/route'

const homes: string[] = []

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.runCommand.mockReset()
  mocks.runCommand.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 })
  mocks.requireRole.mockReturnValue({ user: { role: 'operator', username: 'tester' } })
  mocks.deny.mockReturnValue(null)
  mocks.pin.mockClear()
})

function post(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/sessions/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('handoff helpers', () => {
  it('accepts the four engines and rejects opencode', () => {
    expect(isHandoffKind('claude-code')).toBe(true)
    expect(isHandoffKind('codex-cli')).toBe(true)
    expect(isHandoffKind('grok')).toBe(true)
    expect(isHandoffKind('kimi')).toBe(true)
    expect(isHandoffKind('opencode')).toBe(false)
  })

  it('clips excerpts and builds a bounded context prompt', () => {
    expect(clipExcerpt(`  ${'a'.repeat(4010)}  `)).toHaveLength(4000)
    const prompt = buildHandoffPrompt({
      title: 'Auth gate',
      sourceKind: 'claude-code',
      sourceId: 'sess-1',
      project: '/Users/dev/app',
      excerpt: `${'x'.repeat(5000)}\nkeep`,
      note: 'n'.repeat(2000),
    })
    expect(prompt).toContain('Auth gate')
    expect(prompt).toContain('claude-code')
    expect(prompt).toContain('sess-1')
    expect(prompt).toContain('/Users/dev/app')
    expect(prompt.toLowerCase()).toContain('without losing context')
    expect(prompt).toContain('Operator note:')
    expect(prompt.length).toBeLessThanOrEqual(6000)
    expect(prompt).not.toContain('x'.repeat(4001))
  })

  it('parses a UUID from CLI output and quotes shell args', () => {
    expect(parseSpawnedSessionId('id 550e8400-e29b-41d4-a716-446655440000 done'))
      .toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(parseSpawnedSessionId('no id here')).toBeNull()
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('builds resume vs spawn argv for each engine', () => {
    const base = { prompt: 'go', cwd: '/tmp/app', bin: 'bin', modelId: 'm1', effort: 'high' }
    const claude = buildHandoffCommand({ kind: 'claude-code', resumeId: 's1', ...base })
    expect(claude.command).toBe('sh')
    expect(claude.args[1]).toContain('--resume')
    expect(claude.input).toBe('go')
    expect(buildHandoffCommand({ kind: 'claude-code', resumeId: null, ...base }).args[1])
      .not.toContain('--resume')

    const grok = buildHandoffCommand({ kind: 'grok', resumeId: 's1', ...base })
    expect(grok.args).toEqual(['-p', '--resume', 's1', '--model', 'm1', '--effort', 'high'])
    expect(buildHandoffCommand({ kind: 'grok', resumeId: null, ...base }).args)
      .toEqual(['-p', '--model', 'm1', '--effort', 'high'])

    const kimiResume = buildHandoffCommand({ kind: 'kimi', resumeId: 's1', ...base })
    expect(kimiResume.args).toEqual(['-S', 's1', '-p', '-m', 'm1'])
    expect(kimiResume.input).toBe('go')
    expect(buildHandoffCommand({ kind: 'kimi', resumeId: null, ...base }).args)
      .toEqual(['-p', '-m', 'm1'])

    const codex = buildHandoffCommand({
      kind: 'codex-cli', resumeId: 's1', ...base, outputPath: '/tmp/out.txt',
    })
    expect(codex.args).toEqual(['exec', '-m', 'm1', 'resume', 's1', '--skip-git-repo-check', '-o', '/tmp/out.txt'])
    expect(codex.input).toBe('go')
    expect(buildHandoffCommand({
      kind: 'codex-cli', resumeId: null, ...base, outputPath: '/tmp/out.txt',
    }).args).not.toContain('resume')
  })

  it('reads cwd from the session jsonl head and retries spawn once', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mc-handoff-'))
    homes.push(home)
    const dir = join(home, '.claude', 'projects', '-tmp-app')
    mkdirSync(dir, { recursive: true })
    const project = join(home, 'app')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(dir, 'sess-1.jsonl'), `${JSON.stringify({ cwd: project })}\n`)
    expect(await resolveSessionCwd('sess-1', '', home)).toBe(project)
    expect(await resolveSessionCwd('sess-1', join(home, 'other'), home)).toBe(join(home, 'other'))
    expect(await resolveSessionCwd('sess-1', '/etc', home)).toBe(project)

    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    mocks.runCommand.mockRejectedValueOnce(missing)
    mocks.runCommand.mockResolvedValueOnce({ stdout: 'recovered', stderr: '', code: 0 })
    const result = await runHandoffWithRetry({ command: 'grok', args: ['-p'], input: 'go' })
    expect(result.stdout).toBe('recovered')
    expect(mocks.runCommand).toHaveBeenCalledTimes(2)
    mocks.runCommand.mockRejectedValueOnce(new Error('auth failed'))
    await expect(runHandoffWithRetry({ command: 'grok', args: ['-p'], input: 'go' })).rejects.toThrow('auth failed')
  })
})

describe('POST /api/sessions/handoff', () => {
  it('rejects invalid kinds, ids, and overlong excerpts', async () => {
    expect((await post({ sourceKind: 'opencode', targetKind: 'grok', sourceId: 's1' })).status).toBe(400)
    expect((await post({ sourceKind: 'claude-code', targetKind: 'grok', sourceId: 'bad id' })).status).toBe(400)
    expect((await post({ sourceKind: 'grok', targetKind: 'grok', sourceId: 's1', excerpt: 'go' })).status).toBe(400)
    const res = await post({
      sourceKind: 'claude-code', targetKind: 'kimi', sourceId: 's1', excerpt: 'e'.repeat(8001),
    })
    expect(res.status).toBe(400)
  })

  it('resumes the same engine and spawns a new one across engines', async () => {
    const resume = await post({
      sourceKind: 'claude-code',
      sourceId: 'sess-handoff-1',
      targetKind: 'claude-code',
      title: 'Gate',
      project: '/tmp/app',
      excerpt: 'Next: cover auth.',
      fast: true,
    })
    expect(resume.status).toBe(200)
    await expect(resume.json()).resolves.toMatchObject({
      ok: true, mode: 'resume', kind: 'claude-code', id: 'sess-handoff-1', reply: 'ok',
    })
    const resumeCall = mocks.runCommand.mock.calls.at(0) as [string, string[], { input?: string }] | undefined
    expect(resumeCall?.[0]).toBe('sh')
    expect(String(resumeCall?.[2]?.input || '')).toContain('Register')
    expect(String(resumeCall?.[2]?.input || '')).toContain('Next: cover auth.')
    expect(String(resumeCall?.[1]?.[1])).toContain('--resume')
    expect(String(resumeCall?.[1]?.[1])).toContain('claude-haiku-4-5')

    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'spawned 550e8400-e29b-41d4-a716-446655440000',
      stderr: '',
      code: 0,
    })
    const spawned = await post({
      sourceKind: 'claude-code',
      sourceId: 'sess-handoff-1',
      targetKind: 'grok',
      targetModel: 'grok',
      excerpt: 'Next: cover auth.',
    })
    expect(await spawned.json()).toMatchObject({
      ok: true, mode: 'spawn', kind: 'grok', id: '550e8400-e29b-41d4-a716-446655440000',
    })
    const spawnArgs = mocks.runCommand.mock.calls.at(1) as [string, string[], { env?: NodeJS.ProcessEnv }] | undefined
    expect(spawnArgs?.[1]).toEqual(expect.arrayContaining(['-p']))
    expect(spawnArgs?.[1]).not.toContain('--resume')
    expect(mocks.pin).toHaveBeenCalled()
    expect(spawnArgs?.[2]?.env?.ADAPTIVE_CONTEXT_POLICY_PATH).toBe('/tmp/policy.json')
    // The window must reach the session as a setting, never as this variable: it outranks
    // the setting and locks the window for the whole session.
    expect(spawnArgs?.[2]?.env).not.toHaveProperty('CLAUDE_CODE_AUTO_COMPACT_WINDOW')
  })

  it('returns pending id when spawn output has no UUID and honors auth isolation', async () => {
    const spawned = await post({
      sourceKind: 'kimi', sourceId: 'sess-k', targetKind: 'codex-cli', excerpt: 'go',
    })
    expect(await spawned.json()).toMatchObject({ ok: true, mode: 'spawn', id: 'pending:codex-cli' })

    mocks.requireRole.mockReturnValue({ error: 'Authentication required', status: 401 } as never)
    expect((await post({ sourceKind: 'grok', sourceId: 's1', targetKind: 'grok' })).status).toBe(401)

    mocks.requireRole.mockReturnValue({ user: { role: 'operator', username: 'tester' } })
    mocks.deny.mockReturnValue(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await post({ sourceKind: 'grok', sourceId: 's1', targetKind: 'grok' })).status).toBe(403)
  })
})
