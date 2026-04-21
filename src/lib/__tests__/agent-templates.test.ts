import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATES, buildAgentConfig, getTemplate } from '@/lib/agent-templates'

describe('buildAgentConfig', () => {
  const tpl = AGENT_TEMPLATES[0]

  it('sets config.model.primary as a string when overrides.model is a string', () => {
    const result = buildAgentConfig(tpl, {
      id: 'test',
      name: 'Test',
      model: 'anthropic/claude-sonnet-4-20250514',
    })
    expect(typeof result.model.primary).toBe('string')
    expect(result.model.primary).toBe('anthropic/claude-sonnet-4-20250514')
  })

  it('preserves the template default model when no override is provided', () => {
    const result = buildAgentConfig(tpl, { id: 'test', name: 'Test' })
    expect(typeof result.model.primary).toBe('string')
    expect(result.model.primary).toBe(tpl.config.model.primary)
  })

  it('applies identity overrides without wrapping them', () => {
    const result = buildAgentConfig(tpl, {
      id: 'test',
      name: 'Test',
      emoji: 'X',
      theme: 'some theme',
    })
    expect(result.identity.name).toBe('Test')
    expect(result.identity.emoji).toBe('X')
    expect(result.identity.theme).toBe('some theme')
  })
})

describe('getTemplate', () => {
  it('returns undefined for unknown template ids', () => {
    expect(getTemplate('nope')).toBeUndefined()
  })

  it('returns the matching template', () => {
    const t = getTemplate(AGENT_TEMPLATES[0].type)
    expect(t).toBe(AGENT_TEMPLATES[0])
  })
})
