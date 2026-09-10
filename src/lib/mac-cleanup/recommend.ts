import type { LiveMetrics, ThresholdBreach, Thresholds, TriggerableId } from './types'
import { DEFAULT_THRESHOLDS } from './types'

export function recommendAction(
  metrics: LiveMetrics,
  breaches: ThresholdBreach[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { action: string; reason: string; automationId: TriggerableId | null } {
  const disk = breaches.find((item) => item.id === 'disk')
  const swap = breaches.find((item) => item.id === 'swap')
  const ram = breaches.find((item) => item.id === 'ram')
  const cpu = breaches.find((item) => item.id === 'cpu')

  if (disk?.breached || swap?.breached || ram?.breached || cpu?.breached) {
    return {
      action: 'run-reclaim',
      reason: 'Pressure detected. Safe reclaim will clear idle caches and skip projects with a live working directory.',
      automationId: 'safe-reclaim',
    }
  }

  return {
    action: 'idle',
    reason: 'CPU, RAM, swap, and disk are inside the configured bands.',
    automationId: null,
  }
}
