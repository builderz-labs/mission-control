export type FlyWorkerClass = 'core' | 'browser'
export type FlyCpuKind = 'shared' | 'performance'
export type FlyWorkerSize = 'core-small' | 'core-standard' | 'core-performance' | 'browser-standard' | 'browser-large'

export interface FlyMachineSpec {
  size: FlyWorkerSize
  workerClass: FlyWorkerClass
  cpuKind: FlyCpuKind
  cpus: number
  memoryMb: number
  hourlyCostUsd: number
}

export const FLY_WORKER_SPECS: Record<FlyWorkerSize, FlyMachineSpec> = {
  'core-small': { size: 'core-small', workerClass: 'core', cpuKind: 'shared', cpus: 1, memoryMb: 1024, hourlyCostUsd: 0 },
  'core-standard': { size: 'core-standard', workerClass: 'core', cpuKind: 'shared', cpus: 1, memoryMb: 2048, hourlyCostUsd: 0 },
  'core-performance': { size: 'core-performance', workerClass: 'core', cpuKind: 'performance', cpus: 2, memoryMb: 4096, hourlyCostUsd: 0 },
  'browser-standard': { size: 'browser-standard', workerClass: 'browser', cpuKind: 'performance', cpus: 2, memoryMb: 4096, hourlyCostUsd: 0 },
  'browser-large': { size: 'browser-large', workerClass: 'browser', cpuKind: 'performance', cpus: 4, memoryMb: 8192, hourlyCostUsd: 0 },
}

export interface FlyJobProfile {
  macOnly?: boolean
  requiresBrowser?: boolean
  requiresTesting?: boolean
  estimatedCpuSeconds?: number
  estimatedMemoryMb?: number
  predictedRuntimeSeconds?: number
  predictedCostUsd?: number
  perJobBudgetUsd?: number
}

export interface FlyUsageSample {
  cpuPercent: number
  memoryMb: number
  runtimeSeconds: number
  costUsd: number
}

export interface FlyBudget {
  dailyLimitUsd?: number
  monthlyLimitUsd?: number
  dailySpentUsd: number
  monthlySpentUsd: number
}

export interface FlyCapacity {
  enabled: boolean
  networkAvailable: boolean
  activeWorkers: number
  maxWorkers: number
}

export type FlyRoute = 'local' | 'fly' | 'deferred'

export interface FlyPlacement {
  route: FlyRoute
  workerClass: FlyWorkerClass | null
  reason: string
  fallbackToLocal: boolean
}

function finite(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function percentile(values: number[], ratio: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

export function estimateFlyJobCost(profile: FlyJobProfile, spec: FlyMachineSpec): number {
  const runtimeSeconds = finite(profile.predictedRuntimeSeconds, 60)
  return Math.round((runtimeSeconds / 3600) * finite(spec.hourlyCostUsd) * 1_000_000) / 1_000_000
}

export function isFlyBudgetAllowed(profile: FlyJobProfile, estimateUsd: number, budget: FlyBudget): boolean {
  const cost = Math.max(finite(estimateUsd), finite(profile.predictedCostUsd))
  if (profile.perJobBudgetUsd !== undefined && cost > finite(profile.perJobBudgetUsd)) return false
  if (budget.dailyLimitUsd !== undefined && finite(budget.dailySpentUsd) + cost > finite(budget.dailyLimitUsd)) return false
  return budget.monthlyLimitUsd === undefined || finite(budget.monthlySpentUsd) + cost <= finite(budget.monthlyLimitUsd)
}

export function recommendFlyWorkerSize(profile: FlyJobProfile, history: FlyUsageSample[]): FlyMachineSpec {
  const cpuP95 = percentile(history.map(sample => sample.cpuPercent), 0.95)
  const memoryP95 = percentile(history.map(sample => sample.memoryMb), 0.95)
  const cpu = Math.max(cpuP95, finite(profile.estimatedCpuSeconds) > 600 ? 85 : 0)
  const memory = Math.max(memoryP95, finite(profile.estimatedMemoryMb))

  if (profile.requiresBrowser) {
    return memory > 4096 || cpu > 85 ? FLY_WORKER_SPECS['browser-large'] : FLY_WORKER_SPECS['browser-standard']
  }
  if (memory > 2048 || cpu > 80 || profile.requiresTesting) return FLY_WORKER_SPECS['core-performance']
  if (memory > 1024 || cpu > 50) return FLY_WORKER_SPECS['core-standard']
  return FLY_WORKER_SPECS['core-small']
}

export function decideFlyPlacement(
  profile: FlyJobProfile,
  capacity: FlyCapacity,
  budget: FlyBudget,
  history: FlyUsageSample[],
  pricedSpec?: FlyMachineSpec,
): FlyPlacement {
  if (profile.macOnly) return { route: 'local', workerClass: null, reason: 'Job requires a Mac-only capability.', fallbackToLocal: false }
  const spec = pricedSpec ?? recommendFlyWorkerSize(profile, history)
  const estimate = estimateFlyJobCost(profile, spec)
  if (!capacity.enabled) return { route: 'local', workerClass: spec.workerClass, reason: 'Fly workers are disabled.', fallbackToLocal: true }
  if (!capacity.networkAvailable) return { route: 'local', workerClass: spec.workerClass, reason: 'Fly network is unavailable.', fallbackToLocal: true }
  if (capacity.activeWorkers >= capacity.maxWorkers) return { route: 'deferred', workerClass: spec.workerClass, reason: 'Fly concurrency limit reached.', fallbackToLocal: false }
  if (!isFlyBudgetAllowed(profile, estimate, budget)) return { route: 'deferred', workerClass: spec.workerClass, reason: 'Fly cost budget would be exceeded.', fallbackToLocal: false }
  return { route: 'fly', workerClass: spec.workerClass, reason: `Selected ${spec.size}.`, fallbackToLocal: true }
}

export interface FlyWorkerTelemetry {
  workerId: string
  taskId: number | null
  workerClass: FlyWorkerClass
  size: FlyWorkerSize
  state: 'created' | 'started' | 'running' | 'stopping' | 'destroyed' | 'failed'
  cpuPercent: number | null
  memoryMb: number | null
  swapMb: number | null
  queueDepth: number
  runtimeSeconds: number
  estimatedCostUsd: number
  observedCostUsd: number
  recordedAt: number
}
