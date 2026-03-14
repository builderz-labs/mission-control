import { describe, it, expect } from 'vitest'

describe('Linear Sync Engine', () => {
  it('returns zeros when sync is not enabled', async () => {
    const { pullFromLinear } = await import('@/lib/linear-sync-engine')
    const project = {
      id: 1,
      linear_team_id: null,
      linear_sync_enabled: 0,
    }
    const result = await pullFromLinear(project as any, 1)
    expect(result).toEqual({ pulled: 0, pushed: 0 })
  })

  it('returns zeros when team_id is null', async () => {
    const { pullFromLinear } = await import('@/lib/linear-sync-engine')
    const project = {
      id: 1,
      linear_team_id: null,
      linear_sync_enabled: 1,
    }
    const result = await pullFromLinear(project as any, 1)
    expect(result).toEqual({ pulled: 0, pushed: 0 })
  })

  it('getUserMapping returns null when no mapping exists', async () => {
    const { getUserMapping } = await import('@/lib/linear-sync-engine')
    const result = getUserMapping('test-agent', 1)
    expect(result).toBe(null)
  })
})
