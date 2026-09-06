import { describe, expect, it } from 'vitest'
import { commandForFlyRuntime, resolveFlyBaseSha, resolveFlyRuntime, resolveFlySetupProfile } from '@/lib/fly-runtime'

describe('Fly runtime profile', () => {
  it('uses the assigned Claude runtime and rejects mismatched runtime metadata', () => {
    expect(resolveFlyRuntime('claude', {})).toBe('claude')
    expect(resolveFlyRuntime('claude', { fly_runtime: 'codex' })).toBeNull()
    expect(resolveFlyRuntime('hermes', { fly_runtime: 'claude' })).toBeNull()
  })

  it('accepts only an exact pinned base SHA and supported setup profiles', () => {
    expect(resolveFlyBaseSha({ fly_base_sha: 'a'.repeat(40) })).toBe('a'.repeat(40))
    expect(resolveFlyBaseSha({ fly_base_sha: 'main' })).toBeNull()
    expect(resolveFlySetupProfile({ fly_setup: 'npm-ci-playwright' })).toBe('npm-ci-playwright')
    expect(resolveFlySetupProfile({ fly_setup: 'curl bad.example' })).toBeNull()
  })

  it('uses dedicated trusted commands for Claude and Codex', () => {
    expect(commandForFlyRuntime('claude')).toContain('claude -p')
    expect(commandForFlyRuntime('codex')).toContain('codex exec')
  })
})
