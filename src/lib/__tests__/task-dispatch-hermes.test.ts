import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    hermesHome: '/tmp/hermes',
    openclawConfigPath: '',
    openclawStateDir: '',
  },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => {
    throw new Error('getDatabase should not be called in Hermes-only guard')
  }),
  db_helpers: {},
}))

vi.mock('@/lib/logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger')
  return {
    ...actual,
    logger: {
      ...actual.logger,
      info: vi.fn(),
    },
  }
})

import { dispatchAssignedTasks } from '@/lib/task-dispatch'

describe('dispatchAssignedTasks in Hermes-only mode', () => {
  it('short-circuits without calling OpenClaw gateway', async () => {
    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Hermes-only')
  })
})

