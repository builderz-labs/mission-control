import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for the doctor banner dismiss persistence logic.
 * Mirrors the store + banner integration for doctorDismissedAt.
 */

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
const LS_KEY = 'mc-doctor-dismissed-at'

// Simulate the store logic
function createDoctorDismissStore() {
  let storage: Record<string, string> = {}

  return {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, val: string) => { storage[key] = val },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },

    // Store state
    doctorDismissedAt: null as number | null,

    // Initialize from localStorage (mirrors store IIFE)
    init() {
      const raw = this.getItem(LS_KEY)
      this.doctorDismissedAt = raw ? Number(raw) : null
    },

    // Action (mirrors store.dismissDoctor)
    dismissDoctor() {
      const now = Date.now()
      this.setItem(LS_KEY, String(now))
      this.doctorDismissedAt = now
    },

    // Check if dismissed (mirrors banner logic)
    isDismissed() {
      return this.doctorDismissedAt != null && (Date.now() - this.doctorDismissedAt) < TWENTY_FOUR_HOURS
    },
  }
}

describe('doctor banner dismiss persistence', () => {
  let store: ReturnType<typeof createDoctorDismissStore>

  beforeEach(() => {
    store = createDoctorDismissStore()
  })

  it('is not dismissed by default', () => {
    store.init()
    expect(store.isDismissed()).toBe(false)
    expect(store.doctorDismissedAt).toBeNull()
  })

  it('persists dismiss to localStorage', () => {
    store.dismissDoctor()
    expect(store.getItem(LS_KEY)).toBeDefined()
    expect(Number(store.getItem(LS_KEY))).toBeGreaterThan(0)
  })

  it('is dismissed immediately after calling dismissDoctor', () => {
    store.dismissDoctor()
    expect(store.isDismissed()).toBe(true)
  })

  it('survives re-initialization (simulates page refresh)', () => {
    store.dismissDoctor()

    // Simulate fresh store init (page refresh)
    const store2 = createDoctorDismissStore()
    // Copy storage state
    const raw = store.getItem(LS_KEY)
    if (raw) store2.setItem(LS_KEY, raw)
    store2.init()

    expect(store2.isDismissed()).toBe(true)
    expect(store2.doctorDismissedAt).toEqual(store.doctorDismissedAt)
  })

  it('expires after 24 hours', () => {
    const realNow = Date.now
    try {
      const baseTime = 1700000000000
      Date.now = vi.fn(() => baseTime)

      store.dismissDoctor()
      expect(store.isDismissed()).toBe(true)

      // Jump forward 23 hours — still dismissed
      Date.now = vi.fn(() => baseTime + 23 * 60 * 60 * 1000)
      expect(store.isDismissed()).toBe(true)

      // Jump forward 25 hours — no longer dismissed
      Date.now = vi.fn(() => baseTime + 25 * 60 * 60 * 1000)
      expect(store.isDismissed()).toBe(false)
    } finally {
      Date.now = realNow
    }
  })

  it('handles corrupted localStorage value gracefully', () => {
    store.setItem(LS_KEY, 'not-a-number')
    store.init()
    // NaN from Number("not-a-number") — Date.now() - NaN is NaN, < 24h is false
    expect(store.isDismissed()).toBe(false)
  })
})
