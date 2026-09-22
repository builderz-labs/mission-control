import { describe, expect, it } from 'vitest'
import { continueEffort, continueModelId } from '../session-continue-model'

describe('continueModelId', () => {
  it('maps opus and fast mode for claude', () => {
    expect(continueModelId('claude-code', 'opus', false)).toBe('claude-opus-4-6')
    expect(continueModelId('claude-code', 'opus', true)).toBe('claude-haiku-4-5')
  })

  it('ignores anthropic aliases for codex', () => {
    expect(continueModelId('codex-cli', 'opus', false)).toBeUndefined()
    expect(continueModelId('grok', 'opus', false)).toBeUndefined()
  })

  it('maps grok and kimi aliases', () => {
    expect(continueModelId('grok', 'grok', false)).toBe('grok-4.6')
    expect(continueModelId('kimi', 'kimi', false)).toBe('kimi-k2.5')
  })

  it('rejects model ids that look like flags or shell', () => {
    expect(continueModelId('claude-code', '--output=/tmp/pwned', false)).toBeUndefined()
    expect(continueModelId('grok', '$(whoami)', false)).toBeUndefined()
    expect(continueModelId('kimi', '../../etc/passwd', false)).toBeUndefined()
  })

  it('passes effort only for claude and grok', () => {
    expect(continueEffort('claude-code', 'high')).toBe('high')
    expect(continueEffort('grok', 'max')).toBe('max')
    expect(continueEffort('kimi', 'high')).toBeUndefined()
    expect(continueEffort('claude-code', 'nope')).toBeUndefined()
  })
})
