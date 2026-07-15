import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseScriptReviewVerdict } from '@/lib/agent-runtimes'
import { isValidInstallerSha256, resolvePinnedUserToolSpec, runtimeInstallsEnabled, verifyInstallerSha256 } from '@/lib/runtime-install-security'

describe('runtime installer digest verification', () => {
  const installer = '#!/bin/sh\necho verified\n'
  const digest = createHash('sha256').update(installer, 'utf8').digest('hex')

  it('accepts only exact SHA-256 values', () => {
    expect(isValidInstallerSha256(digest)).toBe(true)
    expect(isValidInstallerSha256(digest.toUpperCase())).toBe(true)
    expect(isValidInstallerSha256('')).toBe(false)
    expect(isValidInstallerSha256('sha256:' + digest)).toBe(false)
    expect(isValidInstallerSha256('g'.repeat(64))).toBe(false)
  })

  it('accepts matching content and rejects changed content', () => {
    expect(verifyInstallerSha256(installer, digest)).toEqual({
      valid: true,
      actualSha256: digest,
    })
    expect(verifyInstallerSha256(`${installer}echo changed\n`, digest).valid).toBe(false)
  })

  it('fails closed for missing or malformed expected digests', () => {
    expect(verifyInstallerSha256(installer, '').valid).toBe(false)
    expect(verifyInstallerSha256(installer, 'not-a-digest').valid).toBe(false)
  })

  it('requires an explicit runtime install opt-in', () => {
    expect(runtimeInstallsEnabled({})).toBe(false)
    expect(runtimeInstallsEnabled({ MC_ENABLE_RUNTIME_INSTALLS: 'true' })).toBe(false)
    expect(runtimeInstallsEnabled({ MC_ENABLE_RUNTIME_INSTALLS: '1' })).toBe(true)
  })

  it('does not treat malformed AI output as a safe verdict', () => {
    expect(parseScriptReviewVerdict('SAFE: reviewed')).toEqual({ safe: true, detail: 'SAFE: reviewed' })
    expect(parseScriptReviewVerdict('UNSAFE: exfiltration')).toEqual({ safe: false, detail: 'UNSAFE: exfiltration' })
    expect(parseScriptReviewVerdict('probably safe')).toBeNull()
    expect(parseScriptReviewVerdict('')).toBeNull()
  })

  it('requires immutable per-user tool package specs', () => {
    const commit = 'a'.repeat(40)
    expect(resolvePinnedUserToolSpec('openclaw', { MC_OPENCLAW_GIT_COMMIT: commit })).toEqual({
      spec: `github:openclaw/openclaw#${commit}`,
    })
    expect(resolvePinnedUserToolSpec('claude', { MC_CLAUDE_CODE_VERSION: '1.2.3' })).toEqual({
      spec: '@anthropic-ai/claude-code@1.2.3',
    })
    expect(resolvePinnedUserToolSpec('codex', { MC_CODEX_VERSION: '0.9.0-beta.1' })).toEqual({
      spec: '@openai/codex@0.9.0-beta.1',
    })
    expect(resolvePinnedUserToolSpec('openclaw', {})).toHaveProperty('error')
    expect(resolvePinnedUserToolSpec('claude', { MC_CLAUDE_CODE_VERSION: 'latest' })).toHaveProperty('error')
    expect(resolvePinnedUserToolSpec('codex', { MC_CODEX_VERSION: '^1.2.3' })).toHaveProperty('error')
  })
})
