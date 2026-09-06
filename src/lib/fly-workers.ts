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

function finite(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function percentile(values: number[], ratio: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

export function recommendFlyWorkerSize(profile: FlyJobProfile, history: FlyUsageSample[]): FlyMachineSpec {
  const cpuP95 = percentile(history.map(sample => sample.cpuPercent), 0.95)
  const memoryP95 = percentile(history.map(sample => sample.memoryMb), 0.95)
  const cpu = Math.max(cpuP95, finite(profile.estimatedCpuSeconds) > 600 ? 85 : 0)
  const memory = Math.max(memoryP95, finite(profile.estimatedMemoryMb)) * 1.25 // Preserve headroom below the OOM limit.

  if (profile.requiresBrowser) {
    return memory > 4096 || cpu > 85 ? FLY_WORKER_SPECS['browser-large'] : FLY_WORKER_SPECS['browser-standard']
  }
  if (memory > 2048 || cpu > 80 || profile.requiresTesting) return FLY_WORKER_SPECS['core-performance']
  if (memory > 1024 || cpu > 50) return FLY_WORKER_SPECS['core-standard']
  return FLY_WORKER_SPECS['core-small']
}
