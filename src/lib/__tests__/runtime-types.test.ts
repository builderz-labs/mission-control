import { describe, expect, it } from 'vitest'
import { AGENT_RUNTIME_TYPES, isAgentRuntimeType } from '@/lib/runtime-types'

describe('AGENT_RUNTIME_TYPES', () => {
  it('includes grok and kimi so they are not custom', () => {
    expect(AGENT_RUNTIME_TYPES).toContain('grok')
    expect(AGENT_RUNTIME_TYPES).toContain('kimi')
    expect(AGENT_RUNTIME_TYPES).toContain('claude')
    expect(isAgentRuntimeType('grok')).toBe(true)
    expect(isAgentRuntimeType('kimi')).toBe(true)
    expect(isAgentRuntimeType('unknown')).toBe(false)
  })
})
