import { describe, expect, it } from 'vitest'
import {
  getTierForTask,
  TASK_TIER_MAP,
} from '@/lib/llm/inference-adapter'
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  InferenceAdapter,
  TaskTier,
} from '@/lib/llm/inference-adapter'

describe('inference adapter types', () => {
  it('InferenceAdapter contract can be implemented', () => {
    const adapter: InferenceAdapter = {
      provider: 'test',
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        return {
          text: 'test response',
          tokenCount: { input: 10, output: 5 },
          cost: 0.001,
          latencyMs: 100,
          model: request.model,
        }
      },
    }

    expect(adapter.provider).toBe('test')
    expect(typeof adapter.complete).toBe('function')
  })

  it('InferenceAdapter with optional embed method', () => {
    const adapter: InferenceAdapter = {
      provider: 'test-embed',
      async complete() {
        return { text: '', tokenCount: { input: 0, output: 0 }, cost: 0, latencyMs: 0, model: 'test' }
      },
      async embed(text: string) {
        return new Array(1536).fill(0)
      },
    }

    expect(typeof adapter.embed).toBe('function')
  })
})

describe('getTierForTask', () => {
  it('returns fast for status-update', () => {
    expect(getTierForTask('status-update')).toBe('fast')
  })

  it('returns fast for importance-rating', () => {
    expect(getTierForTask('importance-rating')).toBe('fast')
  })

  it('returns standard for conversation', () => {
    expect(getTierForTask('conversation')).toBe('standard')
  })

  it('returns standard for summarization', () => {
    expect(getTierForTask('summarization')).toBe('standard')
  })

  it('returns complex for architecture', () => {
    expect(getTierForTask('architecture')).toBe('complex')
  })

  it('returns complex for debugging', () => {
    expect(getTierForTask('debugging')).toBe('complex')
  })

  it('defaults to standard for unknown task types', () => {
    expect(getTierForTask('unknown-task')).toBe('standard')
    expect(getTierForTask('')).toBe('standard')
  })

  it('all mapped task types resolve to valid tiers', () => {
    const validTiers: Set<TaskTier> = new Set(['fast', 'standard', 'complex'])
    for (const [taskType, tier] of Object.entries(TASK_TIER_MAP)) {
      expect(validTiers.has(tier), `${taskType} → ${tier}`).toBe(true)
    }
  })
})

describe('ChatMessage type', () => {
  it('accepts system, user, and assistant roles', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    expect(messages).toHaveLength(3)
  })
})
