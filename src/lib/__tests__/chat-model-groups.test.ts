import { describe, expect, it } from 'vitest'
import { accessibleEngines, accessibleModels, engineForProvider, engineFromKind, inferEngineFromText } from '../chat-model-groups'

describe('chat model groups', () => {
  it('lists the four engines first when access is unknown', () => {
    expect(accessibleEngines({})).toEqual(['claude', 'codex', 'kimi', 'grok'])
  })

  it('hides engines the operator cannot use', () => {
    expect(accessibleEngines({ anthropic: true, openai: false, moonshot: true, xai: false })).toEqual(['claude', 'kimi'])
  })

  it('keeps groq out of the model list without groq access', () => {
    const models = accessibleModels({ anthropic: true, groq: false })
    expect(models.every((model) => model.provider !== 'groq')).toBe(true)
    expect(models.some((model) => model.provider === 'anthropic')).toBe(true)
  })

  it('maps providers onto the four LLMs', () => {
    expect(engineForProvider('anthropic')).toBe('claude')
    expect(engineForProvider('openai')).toBe('codex')
    expect(engineForProvider('moonshot')).toBe('kimi')
    expect(engineForProvider('xai')).toBe('grok')
    expect(engineForProvider('groq')).toBeNull()
  })
})

describe('inferEngineFromText', () => {
  it('maps agent names and model ids', () => {
    expect(inferEngineFromText('claude-20x')).toBe('claude')
    expect(inferEngineFromText('Anthropic Sonnet 4.6')).toBe('claude')
    expect(inferEngineFromText('codex')).toBe('codex')
    expect(inferEngineFromText('OpenAI GPT-5.3')).toBe('codex')
    expect(inferEngineFromText('kimi')).toBe('kimi')
    expect(inferEngineFromText('Moonshot K2')).toBe('kimi')
    expect(inferEngineFromText('grok-4.6')).toBe('grok')
    expect(inferEngineFromText('xAI Grok')).toBe('grok')
    expect(engineFromKind('claude-code')).toBe('claude')
    expect(engineFromKind('codex-cli')).toBe('codex')
  })
})
