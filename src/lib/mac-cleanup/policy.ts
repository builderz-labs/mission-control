import type {
  CleanupMode,
  LiveMetrics,
  ThresholdBreach,
  Thresholds,
  TriggerDecision,
  TriggerIntent,
  TriggerableId,
} from './types'
import { DEFAULT_THRESHOLDS } from './types'

function numeric(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function evaluateBreaches(
  metrics: LiveMetrics,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ThresholdBreach[] {
  const cpuBreached = numeric(metrics.cpuLoadPercent)
    && metrics.cpuLoadPercent >= thresholds.cpuHighPercent
  const ramBreached = numeric(metrics.ramFreePercent)
    && metrics.ramFreePercent <= thresholds.ramLowPercent
  const swapBreached = numeric(metrics.swapUsedPercent)
    && metrics.swapUsedPercent >= thresholds.swapHighPercent
  const diskWarn = numeric(metrics.diskFreeGb) && metrics.diskFreeGb < thresholds.diskLowGb
  const diskCritical = numeric(metrics.diskFreeGb)
    && metrics.diskFreeGb < thresholds.diskEmergencyGb

  return [
    {
      id: 'cpu',
      label: 'CPU load',
      breached: cpuBreached,
      severity: cpuBreached ? 'warn' : 'ok',
      value: metrics.cpuLoadPercent,
      threshold: thresholds.cpuHighPercent,
      unit: '%',
      detail: cpuBreached
        ? `Load is at or above ${thresholds.cpuHighPercent}% of logical cores.`
        : `Load is below the ${thresholds.cpuHighPercent}% trigger.`,
    },
    {
      id: 'ram',
      label: 'RAM free',
      breached: ramBreached,
      severity: ramBreached ? 'critical' : 'ok',
      value: metrics.ramFreePercent,
      threshold: thresholds.ramLowPercent,
      unit: '%',
      detail: ramBreached
        ? `Free RAM is at or below ${thresholds.ramLowPercent}%. RAM purge stays disabled.`
        : `Free RAM is above the ${thresholds.ramLowPercent}% floor.`,
    },
    {
      id: 'swap',
      label: 'Swap used',
      breached: swapBreached,
      severity: swapBreached ? 'critical' : 'ok',
      value: metrics.swapUsedPercent,
      threshold: thresholds.swapHighPercent,
      unit: '%',
      detail: swapBreached
        ? `Swap is at or above ${thresholds.swapHighPercent}%. The LaunchAgent ignores swap.`
        : `Swap is below the ${thresholds.swapHighPercent}% pressure line.`,
    },
    {
      id: 'disk',
      label: 'Disk free',
      breached: Boolean(diskWarn),
      severity: diskCritical ? 'critical' : diskWarn ? 'warn' : 'ok',
      value: metrics.diskFreeGb,
      threshold: thresholds.diskEmergencyGb,
      unit: 'GB',
      detail: diskCritical
        ? `Free disk is below the ${thresholds.diskEmergencyGb} GB emergency floor.`
        : diskWarn
          ? `Free disk is below the ${thresholds.diskLowGb} GB maintenance target.`
          : `Free disk is at or above ${thresholds.diskLowGb} GB.`,
    },
  ]
}

export function decideTrigger(input: {
  id: TriggerableId
  mode: CleanupMode
  intent: TriggerIntent
  metrics: LiveMetrics
  thresholds?: Thresholds
  lastAutoAt?: number | null
  now?: number
}): TriggerDecision {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
  const now = input.now ?? Date.now()

  if (input.mode === 'audit' || input.mode === 'dry-run') {
    return { allowed: true, code: 'observe', reason: 'Read-only mode does not mutate the host.' }
  }

  if (input.id === 'resource-guardian') {
    return cooldownDecision(input.lastAutoAt ?? null, now, thresholds, 'observe_ok')
  }

  if (input.id === 'safe-reclaim') {
    if (input.intent === 'manual') {
      return { allowed: true, code: 'reclaim_ok', reason: 'Manual reclaim will skip active projects and busy tools.' }
    }
    return cooldownDecision(input.lastAutoAt ?? null, now, thresholds, 'reclaim_ok')
  }

  if (!numeric(input.metrics.diskFreeGb)) {
    return { allowed: false, code: 'metric_unknown', reason: 'Disk free space could not be measured; fail closed.' }
  }
  if (input.metrics.npmActive == null || input.metrics.pnpmActive == null) {
    return { allowed: false, code: 'tools_unknown', reason: 'npm/pnpm activity could not be sampled; fail closed.' }
  }
  if (input.metrics.npmActive || input.metrics.pnpmActive) {
    return {
      allowed: false,
      code: 'tools_active',
      reason: 'npm or pnpm is active; cache maintenance is deferred.',
    }
  }

  const floor = input.intent === 'watch' ? thresholds.diskEmergencyGb : thresholds.diskTargetGb
  if (input.metrics.diskFreeGb >= floor) {
    return {
      allowed: false,
      code: 'disk_ok',
      reason: `Free disk is ${input.metrics.diskFreeGb} GB, at or above the ${floor} GB ${input.intent} floor.`,
    }
  }

  return cooldownDecision(input.lastAutoAt ?? null, now, thresholds, 'cache_ok')
}

function cooldownDecision(
  lastAutoAt: number | null,
  now: number,
  thresholds: Thresholds,
  okCode: string,
): TriggerDecision {
  if (lastAutoAt != null && now - lastAutoAt < thresholds.cooldownSeconds * 1000) {
    const wait = Math.ceil((thresholds.cooldownSeconds * 1000 - (now - lastAutoAt)) / 1000)
    return {
      allowed: false,
      code: 'cooldown',
      reason: `Last auto run was too recent; wait ${wait}s.`,
    }
  }
  return {
    allowed: true,
    code: okCode,
    reason: okCode === 'cache_ok'
      ? 'Disk is below threshold and package tools are idle.'
      : 'Observation-only guardian run is allowed.',
  }
}
