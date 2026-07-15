import { beforeEach, describe, expect, it, vi } from 'vitest'

const all = vi.fn()
const prepare = vi.fn((_sql: string) => ({ all }))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ prepare }),
}))

import { queryPendingAssignments } from '../adapter'

describe('adapter assignment isolation', () => {
  beforeEach(() => {
    all.mockReset()
    prepare.mockClear()
  })

  it('binds the authenticated workspace in the assignment query', () => {
    all.mockReturnValue([])

    queryPendingAssignments('agent-1', 42)

    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare.mock.calls[0][0]).toContain('AND workspace_id = ?')
    expect(all).toHaveBeenCalledWith('agent-1', 42)
  })
})
