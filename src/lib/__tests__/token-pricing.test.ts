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
    expect(pricing.inputPerMTok).toBe(5.0)
    expect(pricing.outputPerMTok).toBe(25.0)
  })

  it('uses current Anthropic pricing for Opus 4.5/4.6 and Haiku 4.5 (verified 2026-05)', () => {
    // Opus 4.5/4.6 are $5/$25 per MTok (not the old $15/$75 4.1-era pricing).
    expect(getModelPricing('claude-opus-4-5')).toMatchObject({ inputPerMTok: 5.0, outputPerMTok: 25.0 })
    expect(getModelPricing('claude-opus-4-6')).toMatchObject({ inputPerMTok: 5.0, outputPerMTok: 25.0 })
    // Haiku 4.5 is $1/$5 (Haiku 3.5 retired stays $0.80/$4).
    expect(getModelPricing('claude-haiku-4-5')).toMatchObject({ inputPerMTok: 1.0, outputPerMTok: 5.0 })
    expect(getModelPricing('claude-3-5-haiku')).toMatchObject({ inputPerMTok: 0.8, outputPerMTok: 4.0 })
    // Sonnet 4.6 unchanged at $3/$15.
    expect(getModelPricing('claude-sonnet-4-6')).toMatchObject({ inputPerMTok: 3.0, outputPerMTok: 15.0 })
  })

  it('falls back to conservative default pricing for unknown models', () => {
    const cost = calculateTokenCost('unknown/model', 1_000_000, 1_000_000)
    expect(cost).toBe(18)
  })

  it('uses current Groq pricing for Llama 8B and 70B (verified 2026-06)', () => {
    expect(getModelPricing('groq/llama-3.1-8b-instant')).toMatchObject({ inputPerMTok: 0.05, outputPerMTok: 0.08 })
    expect(getModelPricing('groq/llama-3.3-70b-versatile')).toMatchObject({ inputPerMTok: 0.59, outputPerMTok: 0.79 })
  })

  it('uses current Moonshot and MiniMax pricing (verified 2026-07)', () => {
    // Kimi K2.5 is $0.60/$3.00 and MiniMax M2.1 is $0.30/$1.20 per MTok —
    // the old single "blended" rates undercounted output cost.
    expect(getModelPricing('moonshot/kimi-k2.5')).toMatchObject({ inputPerMTok: 0.6, outputPerMTok: 3.0 })
    expect(getModelPricing('minimax/minimax-m2.1')).toMatchObject({ inputPerMTok: 0.3, outputPerMTok: 1.2 })
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
