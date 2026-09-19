import { describe, expect, it } from 'vitest'
import { extractAgentName } from '@/lib/gateway-session-key'

describe('extractAgentName', () => {
  it('accepts agent keys and rejects traversal', () => {
    expect(extractAgentName('agent:jarv:main')).toBe('jarv')
    expect(extractAgentName('agent:../other:x')).toBeNull()
    expect(extractAgentName('agent:foo/../../.ssh:x')).toBeNull()
    expect(extractAgentName('not-an-agent')).toBeNull()
  })
})
