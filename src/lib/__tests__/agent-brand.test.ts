import { describe, expect, it } from 'vitest'
import { brandFromAgent, brandLogo } from '@/lib/agent-brand'

describe('agent brand', () => {
  it('maps fleet names and runtimes', () => {
    expect(brandFromAgent('claude-1', 'claude')).toBe('claude')
    expect(brandFromAgent('claude-2', 'claude')).toBe('claude')
    expect(brandFromAgent('codex', 'codex')).toBe('codex')
    expect(brandFromAgent('grok', null)).toBe('grok')
    expect(brandFromAgent('kimi', 'kimi')).toBe('kimi')
    expect(brandLogo(brandFromAgent('grok'))?.src).toContain('grok-logo')
    expect(brandFromAgent('mystery')).toBe('unknown')
    expect(brandLogo('unknown')).toBeNull()
  })
})
