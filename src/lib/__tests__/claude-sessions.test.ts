import { describe, expect, it } from 'vitest'
import { isIgnoredClaudeSessionProject } from '@/lib/claude-sessions'

describe('isIgnoredClaudeSessionProject', () => {
  it('keeps normal Claude Code project sessions visible', () => {
    expect(isIgnoredClaudeSessionProject('-Users-doctor', '/Users/doctor')).toBe(false)
  })

  it('ignores claude-mem observer sessions by slug', () => {
    expect(isIgnoredClaudeSessionProject('-Users-doctor--claude-mem-observer-sessions')).toBe(true)
  })

  it('ignores claude-mem observer sessions by project path', () => {
    expect(isIgnoredClaudeSessionProject('-tmp-session', '/Users/doctor/.claude-mem/observer-sessions')).toBe(true)
  })
})
