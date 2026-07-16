import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatHermesCommandOutput, hermesMutationSchema, parseHermesSetupCommand } from '@/lib/hermes-route-security'

describe('Hermes route security boundary', () => {
  it('accepts only setup commands used by the onboarding UI', () => {
    expect(parseHermesSetupCommand('hermes status')).toEqual(['status'])
    expect(parseHermesSetupCommand('hermes doctor')).toEqual(['doctor'])
    expect(parseHermesSetupCommand('hermes version')).toEqual(['version'])
    expect(parseHermesSetupCommand('hermes config set model.default openai/gpt-5')).toEqual([
      'config', 'set', 'model.default', 'openai/gpt-5',
    ])
  })

  it.each([
    'hermes-malicious status',
    'hermes gateway stop',
    'hermes config set arbitrary.key value',
    'hermes config set model.default --dangerous',
    'sh -c whoami',
  ])('rejects command outside the setup allowlist: %s', (command) => {
    expect(parseHermesSetupCommand(command)).toBeNull()
  })

  it('redacts named secrets, strips controls, and caps output', () => {
    const output = formatHermesCommandOutput(`\u001b[31mtoken=super-secret-value\u001b[0m`, 'x'.repeat(20_000))
    expect(output).not.toContain('super-secret-value')
    expect(output).not.toContain('\u001b')
    expect(output).toContain('token=***REDACTED***')
    expect(output).toContain('…[truncated]')
    expect(output.length).toBeLessThan(16_100)
  })

  it('strictly validates action-specific bodies and secret sizes', () => {
    expect(hermesMutationSchema.safeParse({ action: 'set-env', key: 'OPENAI_API_KEY', value: 'key' }).success).toBe(true)
    expect(hermesMutationSchema.safeParse({ action: 'set-env', key: 'PATH', value: '/tmp' }).success).toBe(false)
    expect(hermesMutationSchema.safeParse({ action: 'install-hook', unexpected: true }).success).toBe(false)
    expect(hermesMutationSchema.safeParse({ action: 'run-command', command: 'x'.repeat(501) }).success).toBe(false)
    expect(hermesMutationSchema.safeParse({ action: 'run-oauth-model', provider: '--help' }).success).toBe(false)
  })

  it('keeps authorization before the critical limiter and validates before dispatch', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/hermes/route.ts'), 'utf8')
    const authAt = source.indexOf("requireRole(request, 'admin')")
    const limitAt = source.indexOf('hermesMutationLimiter(limitKey)')
    const validateAt = source.indexOf('validateBody(request, hermesMutationSchema)')
    const dispatchAt = source.indexOf("if (action === 'install-hook')")

    expect(authAt).toBeGreaterThan(-1)
    expect(limitAt).toBeGreaterThan(authAt)
    expect(validateAt).toBeGreaterThan(limitAt)
    expect(dispatchAt).toBeGreaterThan(validateAt)
    expect(source).toContain('chmodSync(envPath, 0o600)')
    expect(source).toContain('chmodSync(soulPath, 0o600)')
    expect(source).not.toContain("trimmed.startsWith('hermes')")
    expect(source).not.toContain('hookDir: HOOK_DIR')
  })
})
