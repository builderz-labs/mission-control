import { describe, expect, it } from 'vitest'
import { calculateTokenCost, getModelPricing } from '@/lib/token-pricing'
import { getProviderFromModel } from '@/lib/provider-subscriptions'

describe('token pricing', () => {
  it('uses separate input/output rates for Claude Sonnet 4.5', () => {
    const cost = calculateTokenCost('anthropic/claude-sonnet-4-5', 10, 185)
    expect(cost).toBeCloseTo(0.002805, 9)
  })

  it('matches model aliases by short model name', () => {
    const pricing = getModelPricing('gateway::claude-opus-4-6')
    expect(pricing.inputPerMTok).toBe(15.0)
    expect(pricing.outputPerMTok).toBe(75.0)
  })

  it('falls back to conservative default pricing for unknown models', () => {
    const cost = calculateTokenCost('unknown/model', 1_000_000, 1_000_000)
    expect(cost).toBe(18)
  })

  it('keeps local models at zero cost', () => {
    const cost = calculateTokenCost('ollama/qwen2.5-coder:14b', 50_000, 50_000)
    expect(cost).toBe(0)
  })

  it('returns zero cost for subscribed providers', () => {
    const cost = calculateTokenCost('anthropic/claude-sonnet-4-5', 2000, 2000, {
      providerSubscriptions: { anthropic: true },
    })
    expect(cost).toBe(0)
  })

  it('maps providers from model prefixes and names', () => {
    expect(getProviderFromModel('openai/gpt-4.1')).toBe('openai')
    expect(getProviderFromModel('anthropic/claude-sonnet-4-5')).toBe('anthropic')
    expect(getProviderFromModel('venice/llama-3.3-70b')).toBe('venice')
    expect(getProviderFromModel('gateway::codex-mini')).toBe('openai')
  })
})
