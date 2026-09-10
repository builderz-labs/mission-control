import { describe, expect, it } from 'vitest'
import { collectLiveMetrics } from '@/lib/mac-cleanup/metrics'
import { decideTrigger, evaluateBreaches } from '@/lib/mac-cleanup/policy'
import { recommendAction } from '@/lib/mac-cleanup/recommend'
import { listAutomations, readLaunchdMap } from '@/lib/mac-cleanup/status'

describe('mac cleanup live host smoke', () => {
  it('samples Darwin metrics and applies fail-closed policy', async () => {
    if (process.platform !== 'darwin') return
    const metrics = await collectLiveMetrics({ samplePackages: true })
    expect(metrics.cpuLoadPercent).toBeGreaterThanOrEqual(0)
    expect(metrics.diskFreeGb == null || metrics.diskFreeGb >= 0).toBe(true)

    const launchd = await readLaunchdMap()
    const automations = listAutomations(launchd)
    expect(automations.map((job) => job.id)).toEqual([
      'safe-reclaim',
      'resource-guardian',
      'storage-maintenance',
      'clean-mac',
      'clean-ram',
      'safe-disk-maintenance',
    ])
    expect(automations.find((job) => job.id === 'safe-disk-maintenance')?.triggerable).toBe(false)

    const breaches = evaluateBreaches(metrics)
    const recommendation = recommendAction(metrics, breaches)
    expect(recommendation.action).toMatch(/wait|run-storage|run-reclaim|watch|observe|idle/)

    const blocked = decideTrigger({
      id: 'storage-maintenance',
      mode: 'auto',
      intent: 'watch',
      metrics: { ...metrics, npmActive: true, diskFreeGb: 10 },
    })
    expect(blocked.allowed).toBe(false)
    expect(blocked.code).toBe('tools_active')
  }, 20_000)
})
