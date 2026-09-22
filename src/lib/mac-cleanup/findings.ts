import type { AutomationView, LiveMetrics } from './types'

export function buildFindings(
  automations: AutomationView[],
  metrics: LiveMetrics,
  staleLocks: number,
  available: boolean,
): string[] {
  if (!available) return ['Mac cleanup automations are only available on the Darwin host.']

  const findings: string[] = []
  const guardian = automations.find((job) => job.id === 'resource-guardian')
  const storage = automations.find((job) => job.id === 'storage-maintenance')
  const cleanMac = automations.find((job) => job.id === 'clean-mac')
  const cleanRam = automations.find((job) => job.id === 'clean-ram')
  const legacy = automations.find((job) => job.id === 'safe-disk-maintenance')

  const reclaim = automations.find((job) => job.id === 'safe-reclaim')
  if (reclaim && !reclaim.loaded) {
    findings.push('Safe reclaim LaunchAgent is not loaded; Mission Control watch can still run it in-process.')
  }
  if (cleanMac?.loaded && cleanRam?.loaded && guardian?.loaded && reclaim?.loaded) {
    findings.push('clean-mac and clean-ram now share the safe-reclaim binary with the guardian observer.')
  }
  if (legacy && !legacy.loaded) {
    findings.push('Legacy safe-disk-maintenance is not loaded. Keep it unloaded; it deletes caches and prunes Docker images.')
  }
  if (staleLocks > 0) {
    findings.push(`${staleLocks} stale guardian lock directories are left in ~/.local/state/mac-resource-guardian.`)
  }
  if (storage?.lastStatus === 'critical_pressure' || storage?.lastStatus === 'pressure_persisted') {
    findings.push(`Storage last run ended ${storage.lastStatus} (npm/pnpm prune deferred or pressure remained).`)
  }
  if (metrics.swapUsedPercent != null && metrics.swapUsedPercent >= 80) {
    findings.push('Swap is nearly full. The LaunchAgent only watches memory_pressure free percent, so it misses swap thrash.')
  }
  if (guardian?.loaded && guardian.lastCycleAt) {
    const age = Math.floor(Date.now() / 1000) - guardian.lastCycleAt
    if (age > 180) findings.push(`Guardian last-cycle stamp is ${age}s old (healthcheck stale after 180s).`)
  }
  if (findings.length === 0) findings.push('Host automations are loaded and no structural issues were found.')
  return findings
}
