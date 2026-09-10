import { describe, expect, it } from 'vitest'
import { buildMacCleanupSnapshot } from '@/lib/mac-cleanup/snapshot'

describe('mac cleanup snapshot', () => {
  it('builds a monitor payload on Darwin', async () => {
    if (process.platform !== 'darwin') return
    const snapshot = await buildMacCleanupSnapshot()
    expect(snapshot.available).toBe(true)
    expect(snapshot.thresholds.diskEmergencyGb).toBe(20)
    expect(snapshot.breaches).toHaveLength(4)
    expect(snapshot.automations.length).toBe(6)
    expect(snapshot.protectedProjects.length).toBeGreaterThan(0)
    expect(snapshot.findings.length).toBeGreaterThan(0)
  }, 20_000)
})
