import { describe, expect, it } from 'vitest'
import { redactCommandLine, summarizeCommandOutput } from '../command'

describe('redactCommandLine', () => {
  it('hides long or whitespace-containing args', () => {
    expect(redactCommandLine('kimi', ['-S', 'sess-1', '-p', 'secret token value'])).toBe('kimi -S sess-1 -p [redacted]')
    expect(redactCommandLine('codex', ['exec', 'resume', 'id', 'sk-live-secret-key-that-is-long'])).toContain('[redacted]')
  })
})

describe('summarizeCommandOutput', () => {
  it('caps large command output before it reaches logs or error responses', () => {
    const summary = summarizeCommandOutput('x'.repeat(2_000), '')

    expect(summary.length).toBeLessThan(550)
    expect(summary).toContain('[truncated]')
  })

  it('prefers stderr and collapses multiline output', () => {
    expect(summarizeCommandOutput('stdout', 'first\nsecond')).toBe('first second')
  })
})
