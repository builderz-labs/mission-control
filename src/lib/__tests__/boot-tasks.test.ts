import { describe, expect, it, vi, afterEach } from 'vitest'

import { settleBootTask } from '@/lib/boot-tasks'

afterEach(() => {
  vi.useRealTimers()
})

describe('settleBootTask', () => {
  it('returns the task result when it finishes before the timeout', async () => {
    await expect(
      settleBootTask(async () => 'ready', 'fallback', 50),
    ).resolves.toBe('ready')
  })

  it('returns the fallback when the task rejects', async () => {
    await expect(
      settleBootTask(async () => {
        throw new Error('boom')
      }, 'fallback', 50),
    ).resolves.toBe('fallback')
  })

  it('returns the fallback when the task does not settle before the timeout', async () => {
    vi.useFakeTimers()

    const pending = settleBootTask(
      () => new Promise<string>(() => {}),
      'fallback',
      50,
    )

    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBe('fallback')
  })
})
