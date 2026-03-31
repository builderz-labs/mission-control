import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    connection: {
      isConnected: false,
      sseConnected: false,
    },
  }),
}))

import { useSmartPoll } from '@/lib/use-smart-poll'

describe('useSmartPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not overlap a new poll while the previous async poll is still running', async () => {
    let resolveCurrent: (() => void) | null = null
    const callback = vi.fn(() => new Promise<void>((resolve) => {
      resolveCurrent = resolve
    }))

    renderHook(() => useSmartPoll(callback, 1000))

    const initialCalls = callback.mock.calls.length
    expect(initialCalls).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(callback).toHaveBeenCalledTimes(initialCalls)

    await act(async () => {
      resolveCurrent?.()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(callback).toHaveBeenCalledTimes(initialCalls + 1)
  })
})
