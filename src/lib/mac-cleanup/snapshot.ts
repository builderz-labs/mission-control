import { getDatabase } from '@/lib/db'
import { collectProtectedRoots } from './active-projects'
import { buildFindings } from './findings'
import { collectLiveMetrics } from './metrics'
import { evaluateBreaches } from './policy'
import { recommendAction } from './recommend'
import { countStaleLocks, listAutomations, readLaunchdMap } from './status'
import { readWatchState } from './state'
import { DEFAULT_THRESHOLDS } from './types'
import type { MacCleanupSnapshot } from './types'

function isWatchEnabled(): boolean {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('general.mac_cleanup_watch') as { value: string } | undefined
    if (row) return row.value === 'true'
    return true
  } catch {
    return true
  }
}

export async function buildMacCleanupSnapshot(): Promise<MacCleanupSnapshot> {
  const available = process.platform === 'darwin'
  const [launchd, metrics, protectedProjects] = await Promise.all([
    readLaunchdMap(),
    collectLiveMetrics({ samplePackages: available }),
    available ? collectProtectedRoots() : Promise.resolve([]),
  ])
  const automations = listAutomations(launchd)
  const thresholds = DEFAULT_THRESHOLDS
  const breaches = evaluateBreaches(metrics, thresholds)
  const recommendation = recommendAction(metrics, breaches, thresholds)
  const watch = readWatchState()

  return {
    timestamp: Date.now(),
    platform: process.platform,
    available,
    metrics,
    thresholds,
    breaches,
    recommendation,
    automations,
    findings: buildFindings(automations, metrics, countStaleLocks(), available),
    protectedProjects,
    watch: { enabled: isWatchEnabled(), lastAutoAt: watch.lastAutoAt },
  }
}
