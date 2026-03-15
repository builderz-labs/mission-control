import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before importing router
vi.mock('@/lib/config', () => ({
  config: {
    llm: {
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: '',
      budgetPerAgentDay: 5,
      models: {
        fast: 'claude-haiku-4-5',
        standard: 'claude-sonnet-4-5',
        complex: 'claude-opus-4-6',
      },
      maxTokens: 4096,
      ratePerAgentPerMinute: 20,
      enabled: true,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockStatement = {
  get: vi.fn().mockReturnValue({ total_cost: 0 }),
  run: vi.fn(),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = { prepare: vi.fn(() => mockStatement) }

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: vi.fn(),
  },
}))

vi.mock('@/lib/token-pricing', () => ({
  calculateTokenCost: vi.fn().mockReturnValue(0.001),
}))

import { complete, checkAgentBudget, setAdapter, resetAdapter } from '@/lib/llm/router'
import type { InferenceAdapter, CompletionRequest, CompletionResponse } from '@/lib/llm/inference-adapter'

function createMockAdapter(overrides?: Partial<CompletionResponse>): InferenceAdapter {
  return {
    provider: 'mock',
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      return {
        text: 'mock response',
        tokenCount: { input: 100, output: 50 },
        cost: 0.001,
        latencyMs: 150,
        model: request.model,
        ...overrides,
      }
    },
  }
}

describe('LLM router', () => {
  beforeEach(() => {
    resetAdapter()
  })

  afterEach(() => {
    resetAdapter()
    vi.restoreAllMocks()
  })

  describe('complete', () => {
    it('calls the adapter with the correct model for task type', async () => {
      const adapter = createMockAdapter()
      const completeSpy = vi.spyOn(adapter, 'complete')
      setAdapter(adapter)

      await complete(
        [{ role: 'user', content: 'Hello' }],
        { agentId: 1, workspaceId: 1, taskType: 'status-update' },
      )

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5' }),
      )
    })

    it('uses standard tier by default', async () => {
      const adapter = createMockAdapter()
      const completeSpy = vi.spyOn(adapter, 'complete')
      setAdapter(adapter)

      await complete(
        [{ role: 'user', content: 'Hello' }],
        { agentId: 1, workspaceId: 1 },
      )

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-5' }),
      )
    })

    it('allows explicit model override', async () => {
      const adapter = createMockAdapter()
      const completeSpy = vi.spyOn(adapter, 'complete')
      setAdapter(adapter)

      await complete(
        [{ role: 'user', content: 'Hello' }],
        { agentId: 1, workspaceId: 1, model: 'custom-model' },
      )

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-model' }),
      )
    })

    it('allows explicit tier override', async () => {
      const adapter = createMockAdapter()
      const completeSpy = vi.spyOn(adapter, 'complete')
      setAdapter(adapter)

      await complete(
        [{ role: 'user', content: 'Hello' }],
        { agentId: 1, workspaceId: 1, tier: 'complex' },
      )

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4-6' }),
      )
    })

    it('returns the adapter response', async () => {
      setAdapter(createMockAdapter({ text: 'the answer is 42' }))

      const response = await complete(
        [{ role: 'user', content: 'What is the answer?' }],
        { agentId: 1, workspaceId: 1 },
      )

      expect(response.text).toBe('the answer is 42')
      expect(response.tokenCount).toEqual({ input: 100, output: 50 })
    })
  })

  describe('checkAgentBudget', () => {
    it('allows calls when under budget', () => {
      const result = checkAgentBudget(1, 1)
      expect(result.allowed).toBe(true)
    })

    it('returns budget info', () => {
      const result = checkAgentBudget(1, 1)
      expect(result.limit).toBe(5)
      expect(typeof result.spent).toBe('number')
    })
  })

  describe('disabled state', () => {
    it('throws when LLM is disabled', async () => {
      // Temporarily override the config
      const configModule = await import('@/lib/config')
      const original = configModule.config.llm.enabled
      configModule.config.llm.enabled = false

      await expect(
        complete(
          [{ role: 'user', content: 'Hello' }],
          { agentId: 1, workspaceId: 1 },
        ),
      ).rejects.toThrow('disabled')

      configModule.config.llm.enabled = original
    })
  })
})
