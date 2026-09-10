import { describe, expect, it } from 'vitest'
import { agentNameForSession, shouldKeepExternalSession } from '@/lib/runtime-history'

describe('runtime history', () => {
  it('keeps prefixed runtime sessions during Claude orphan cleanup', () => {
    expect(shouldKeepExternalSession('grok:abc')).toBe(true)
    expect(shouldKeepExternalSession('kimi:abc')).toBe(true)
    expect(shouldKeepExternalSession('codex:abc')).toBe(true)
    expect(shouldKeepExternalSession('uuid-without-prefix')).toBe(false)
  })

  it('maps Claude homes onto claude-1/claude-2, never leftover claude', () => {
    expect(agentNameForSession('abc', '~/Dev/actz-may')).toBe('claude-1')
    expect(agentNameForSession('abc', '~/.openclaw/workspace-claude-5x')).toBe('claude-2')
    expect(agentNameForSession('abc', '~/.claude-account2/projects')).toBe('claude-2')
    expect(agentNameForSession('grok:1', null)).toBe('grok')
  })
})
