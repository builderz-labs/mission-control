import { collectLiveMetrics } from './metrics'
import { readWatchState, writeWatchState } from './state'
import { runMacCleanup } from './trigger'
import type { CleanupMode, TriggerIntent, TriggerResult, TriggerableId } from './types'

export async function collectAndRun(
  id: TriggerableId,
  mode: CleanupMode,
  intent: TriggerIntent,
): Promise<TriggerResult> {
  const samplePackages = (id === 'storage-maintenance' || id === 'safe-reclaim') && mode === 'auto'
  const metrics = await collectLiveMetrics({ samplePackages })
  const lastAutoAt = readWatchState().lastAutoAt
  const result = await runMacCleanup({ id, mode, intent, metrics, lastAutoAt })
  if (result.ok && mode === 'auto') {
    writeWatchState({
      lastAutoAt: Date.now(),
      lastId: id,
      lastCode: result.decision.code,
    })
  }
  return result
}
