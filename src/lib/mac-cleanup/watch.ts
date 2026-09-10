import { logger } from '@/lib/logger'
import { collectLiveMetrics } from './metrics'
import { decideTrigger } from './policy'
import { readWatchState, writeWatchState } from './state'
import { runMacCleanup } from './trigger'
import { DEFAULT_THRESHOLDS } from './types'

export async function runMacCleanupWatch(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'darwin') {
    return { ok: true, message: 'Mac cleanup watch skipped (not Darwin)' }
  }

  const metrics = await collectLiveMetrics({ samplePackages: true })
  const lastAutoAt = readWatchState().lastAutoAt
  const decision = decideTrigger({
    id: 'safe-reclaim',
    mode: 'auto',
    intent: 'watch',
    metrics,
    thresholds: DEFAULT_THRESHOLDS,
    lastAutoAt,
  })

  if (!decision.allowed) {
    return { ok: true, message: `Watch idle: ${decision.reason}` }
  }

  const result = await runMacCleanup({
    id: 'safe-reclaim',
    mode: 'auto',
    intent: 'watch',
    metrics,
    lastAutoAt,
  })

  if (result.ok) {
    writeWatchState({
      lastAutoAt: Date.now(),
      lastId: result.id,
      lastCode: result.decision.code,
    })
    logger.info({ code: result.decision.code }, 'Mac storage cleanup watch completed')
    return { ok: true, message: 'Safe reclaim ran (active projects skipped)' }
  }

  logger.warn({ reason: result.decision.reason, stderr: result.stderr }, 'Mac storage cleanup watch did not run')
  return { ok: false, message: result.decision.reason || result.stderr || 'Cleanup watch failed' }
}
