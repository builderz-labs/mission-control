import { describe, expect, it } from 'vitest'
import { pickProvider } from '@/lib/task-dispatch'
import { classifyModelProvider } from '@/lib/models'

describe('Grok and Kimi never dispatch through Anthropic', () => {
  it('classifies catalog grok and kimi to xai/moonshot', () => {
    expect(classifyModelProvider('grok-4.6')).toBe('xai')
    expect(classifyModelProvider('xai/grok-4.6')).toBe('xai')
    expect(classifyModelProvider('grok')).toBe('xai')
    expect(classifyModelProvider('kimi')).toBe('moonshot')
    expect(classifyModelProvider('kimi-code/k3')).toBe('moonshot')
    expect(classifyModelProvider('moonshot/kimi-code/k3')).toBe('moonshot')
  })

  it('pickProvider does not fall through to anthropic', () => {
    expect(pickProvider('grok-4.6')).toBe('xai')
    expect(pickProvider('xai/grok-4.6')).toBe('xai')
    expect(pickProvider('kimi')).toBe('moonshot')
    expect(pickProvider('moonshot/kimi-k2.5')).toBe('moonshot')
    expect(pickProvider('kimi-code/k3')).toBe('moonshot')
  })
})
