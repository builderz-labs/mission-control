import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        const key = String(args[0] || '')
        if (key === 'general.model_budget_guard') return undefined
        if (key === 'general.model_budget_reserved_ratio') return { value: '20' }
        if (key === 'subscription.openai_daily_limit') return { value: '10' }
        if (key === 'subscription.openai_weekly_limit') return { value: '50' }
        if (sql.includes('COUNT(*) as count')) return { count: 9 }
        return undefined
      },
    }),
  }),
}))

vi.mock('@/lib/provider-subscriptions', () => ({
  getPrimarySubscription: () => ({ provider: 'openai', type: 'pro' }),
}))

import { decideBudgetRoute, isTrueOwnerRequired, parseTaskMetadata } from '@/lib/task-harness'

describe('task-harness helpers', () => {
  it('detects true owner-required work conservatively', () => {
    expect(isTrueOwnerRequired({ title: 'Need API key rotation' })).toBe(true)
    expect(isTrueOwnerRequired({ title: 'Fix missing repo path', description: 'redefine and retry' })).toBe(false)
  })

  it('parses invalid metadata safely', () => {
    expect(parseTaskMetadata('{oops')).toEqual({})
  })

  it('falls back to a cheaper model when budget is nearly exhausted', () => {
    const result = decideBudgetRoute({
      taskId: 1,
      priority: 'medium',
      preferredModel: 'gpt-5',
      fallbackModel: 'gpt-5-mini',
      workspaceId: 1,
    })
    expect(result.action).toBe('fallback')
    expect(result.selectedModel).toBe('gpt-5-mini')
  })
})
