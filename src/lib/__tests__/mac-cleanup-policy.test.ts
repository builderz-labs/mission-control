import { describe, expect, it } from 'vitest'
import { decideTrigger, evaluateBreaches } from '@/lib/mac-cleanup/policy'
import { recommendAction } from '@/lib/mac-cleanup/recommend'
import { DEFAULT_THRESHOLDS, type LiveMetrics } from '@/lib/mac-cleanup/types'

const healthy: LiveMetrics = {
  cpuLoadPercent: 20,
  ramFreePercent: 40,
  swapUsedPercent: 10,
  diskFreeGb: 80,
  npmActive: false,
  pnpmActive: false,
}

describe('evaluateBreaches', () => {
  it('marks disk critical below the emergency floor', () => {
    const breaches = evaluateBreaches({ ...healthy, diskFreeGb: 15 })
    const disk = breaches.find((item) => item.id === 'disk')
    expect(disk?.breached).toBe(true)
    expect(disk?.severity).toBe('critical')
  })

  it('marks swap pressure when used percent is high', () => {
    const swap = evaluateBreaches({ ...healthy, swapUsedPercent: 98 }).find((item) => item.id === 'swap')
    expect(swap?.breached).toBe(true)
    expect(swap?.severity).toBe('critical')
  })

  it('does not treat unknown metrics as a breach', () => {
    const breaches = evaluateBreaches({
      cpuLoadPercent: null,
      ramFreePercent: null,
      swapUsedPercent: null,
      diskFreeGb: null,
      npmActive: null,
      pnpmActive: null,
    })
    expect(breaches.every((item) => !item.breached && item.severity === 'ok')).toBe(true)
  })
})

describe('decideTrigger', () => {
  it('allows audit and dry-run without host mutation', () => {
    for (const mode of ['audit', 'dry-run'] as const) {
      const decision = decideTrigger({
        id: 'storage-maintenance',
        mode,
        intent: 'manual',
        metrics: { ...healthy, npmActive: true },
      })
      expect(decision.allowed).toBe(true)
      expect(decision.code).toBe('observe')
    }
  })

  it('blocks cache auto when npm is busy', () => {
    const decision = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...healthy, diskFreeGb: 12, npmActive: true },
    })
    expect(decision).toMatchObject({ allowed: false, code: 'tools_active' })
  })

  it('blocks cache auto when package activity is unknown', () => {
    const decision = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...healthy, diskFreeGb: 12, npmActive: null, pnpmActive: false },
    })
    expect(decision.code).toBe('tools_unknown')
  })

  it('blocks watch auto until the emergency disk floor', () => {
    const decision = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...healthy, diskFreeGb: 30 },
    })
    expect(decision.code).toBe('disk_ok')
  })

  it('allows watch auto below the emergency floor when tools are idle', () => {
    const decision = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...healthy, diskFreeGb: 12 },
      lastAutoAt: null,
      now: 1_000_000,
    })
    expect(decision).toMatchObject({ allowed: true, code: 'cache_ok' })
  })

  it('enforces cooldown after a recent auto run', () => {
    const now = 1_800_000
    const decision = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...healthy, diskFreeGb: 12 },
      lastAutoAt: now - 10_000,
      now,
    })
    expect(decision.code).toBe('cooldown')
  })
})

describe('recommendAction', () => {
  it('recommends safe reclaim under disk pressure even when npm is busy', () => {
    const metrics = { ...healthy, diskFreeGb: 12, npmActive: true }
    const result = recommendAction(metrics, evaluateBreaches(metrics), DEFAULT_THRESHOLDS)
    expect(result).toMatchObject({ action: 'run-reclaim', automationId: 'safe-reclaim' })
  })
})

describe('safe-reclaim trigger policy', () => {
  it('allows manual auto reclaim without waiting for npm to go idle', () => {
    const decision = decideTrigger({
      id: 'safe-reclaim',
      mode: 'auto',
      intent: 'manual',
      metrics: { ...healthy, npmActive: true, diskFreeGb: 80 },
    })
    expect(decision).toMatchObject({ allowed: true, code: 'reclaim_ok' })
  })

  it('still rate-limits watch auto reclaim', () => {
    const now = 2_000_000
    const decision = decideTrigger({
      id: 'safe-reclaim',
      mode: 'auto',
      intent: 'watch',
      metrics: healthy,
      lastAutoAt: now - 1000,
      now,
    })
    expect(decision.code).toBe('cooldown')
  })
})
