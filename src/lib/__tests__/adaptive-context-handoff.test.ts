import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fleetAgentFromHandoff, handoffKindFromAgent, sameHandoffSeat } from '@/lib/adaptive-context-agent'
import {
  ledgerFromSession, parseAdaptiveHandoff, pinAdaptiveContext, resolveWorkspacePolicyPath,
} from '@/lib/adaptive-context-handoff'
import { buildHandoffCommand } from '@/lib/session-handoff'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: '{}', stderr: '', code: 0 })),
}))
vi.mock('@/lib/command', () => ({ runCommand: mocks.runCommand }))

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('fleet agent mapping', () => {
  it('keeps claude-20x and claude-5x distinct and accepts aliases', () => {
    expect(fleetAgentFromHandoff('claude-code', 'claude-5x')).toBe('claude-2')
    expect(fleetAgentFromHandoff('claude-code', 'claude-2')).toBe('claude-2')
    expect(fleetAgentFromHandoff('claude-code', 'claude-1')).toBe('claude-1')
    expect(fleetAgentFromHandoff('claude-code', 'claude-20x')).toBe('claude-1')
    expect(fleetAgentFromHandoff('claude-code')).toBe('claude-1')
    expect(fleetAgentFromHandoff('codex-cli')).toBe('codex')
    expect(handoffKindFromAgent('claude-2')).toBe('claude-code')
    expect(handoffKindFromAgent('codex')).toBe('codex-cli')
    expect(sameHandoffSeat('claude-code', 'claude-code', 'claude-1', 'claude-1')).toBe(true)
    expect(sameHandoffSeat('claude-code', 'claude-code', 'claude-1', 'claude-2')).toBe(false)
  })
})

describe('adaptive-context pin', () => {
  it('parses the shared window and launch overrides', () => {
    const parsed = parseAdaptiveHandoff(JSON.stringify({
      ok: true,
      handoff: { window: 245400, compactRequired: true },
      launch: { to: { env: { GROK_CONFIG_PATH: '/x/grok.toml' }, argv: ['-c', 'model_auto_compact_token_limit=245400'] } },
    }))
    expect(parsed.window).toBe(245400)
    expect(parsed.compactRequired).toBe(true)
    expect(parsed.argv).toEqual(['-c', 'model_auto_compact_token_limit=245400'])
    expect(() => parseAdaptiveHandoff('not-json')).toThrow(/not JSON/)
    expect(ledgerFromSession({ title: 'Auth sk-secretvaluexx', excerpt: 'next' }).objective).not.toContain('sk-secretvaluexx')
  })

  it('writes a ledger and retries the CLI once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-pin-'))
    dirs.push(root)
    process.env.ADAPTIVE_CONTEXT_CONFIG_HOME = root
    try {
      mocks.runCommand.mockRejectedValueOnce(Object.assign(new Error('timeout'), { timedOut: true }))
      mocks.runCommand.mockResolvedValueOnce({
        stdout: JSON.stringify({
          ok: true,
          handoff: { window: 160000, compactRequired: false },
          launch: { to: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '160000' }, argv: [] } },
        }),
        stderr: '',
        code: 0,
      })
      const pin = await pinAdaptiveContext({
        from: 'grok', to: 'claude-1', cwd: root, title: 'Gate', excerpt: 'Cover auth.',
      })
      expect(pin.window).toBe(160000)
      expect(pin.from).toBe('grok')
      expect(pin.to).toBe('claude-1')
      expect(mocks.runCommand).toHaveBeenCalledTimes(2)
      const ledger = JSON.parse(readFileSync(join(root, '.adaptive-context', 'ledger.json'), 'utf8')) as { objective: string }
      expect(ledger.objective).toContain('Gate')
      expect(await resolveWorkspacePolicyPath(root, root)).toBe(join(root, '.adaptive-context', 'policy.json'))
    } finally {
      delete process.env.ADAPTIVE_CONTEXT_CONFIG_HOME
    }
  })

  it('prepends Codex compact overrides before exec', () => {
    const spec = buildHandoffCommand({
      kind: 'codex-cli', resumeId: null, prompt: 'go', cwd: '/tmp', bin: 'codex',
      extraArgs: ['-c', 'model_auto_compact_token_limit=245400'],
      env: { ...process.env, ADAPTIVE_CONTEXT_POLICY_PATH: '/x/policy.json' },
      outputPath: '/tmp/out.txt',
    })
    expect(spec.args.slice(0, 3)).toEqual(['-c', 'model_auto_compact_token_limit=245400', 'exec'])
    expect(spec.env?.ADAPTIVE_CONTEXT_POLICY_PATH).toBe('/x/policy.json')
  })
})
