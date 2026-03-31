import { describe, expect, it } from 'vitest'
import { mergeRuntimeTaskStats } from '@/lib/runtime-task-stats'

describe('mergeRuntimeTaskStats', () => {
  it('adds runtime-derived task counts onto db task counts', () => {
    const merged = mergeRuntimeTaskStats(
      {
        total: 3,
        byStatus: {
          inbox: 1,
          review: 1,
          done: 1,
        },
      },
      [
        { status: 'assigned' },
        { status: 'review' },
        { status: 'awaiting_owner' as any },
      ],
    )

    expect(merged.total).toBe(6)
    expect(merged.dbTotal).toBe(3)
    expect(merged.runtimeTotal).toBe(3)
    expect(merged.byStatus).toEqual({
      inbox: 1,
      review: 2,
      done: 1,
      assigned: 1,
      awaiting_owner: 1,
    })
    expect(merged.runtimeByStatus).toEqual({
      assigned: 1,
      review: 1,
      awaiting_owner: 1,
    })
  })
})
