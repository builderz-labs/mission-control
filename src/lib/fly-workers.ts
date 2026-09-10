export type FlyWorkerClass = 'core' | 'browser'
export type FlyCpuKind = 'shared' | 'performance'
export type FlyWorkerSize = 'core-small' | 'core-standard' | 'core-performance' | 'core-xlarge' | 'browser-standard' | 'browser-large'

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
  'core-xlarge': { size: 'core-xlarge', workerClass: 'core', cpuKind: 'performance', cpus: 4, memoryMb: 8192, hourlyCostUsd: 0 },
  'browser-standard': { size: 'browser-standard', workerClass: 'browser', cpuKind: 'performance', cpus: 2, memoryMb: 4096, hourlyCostUsd: 0 },
  'browser-large': { size: 'browser-large', workerClass: 'browser', cpuKind: 'performance', cpus: 4, memoryMb: 8192, hourlyCostUsd: 0 },
}

export interface FlyJobProfile {
  macOnly?: boolean
  requiresBrowser?: boolean
  requiresTesting?: boolean
  requiresBuild?: boolean
  requiresDependencies?: boolean
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
  /**
   * vCPUs of the Machine that produced the sample. `cpuPercent` is already a share of
   * that whole Machine, so it only becomes comparable across classes once multiplied
   * back into vCPUs. Defaults to one vCPU, the smallest class, when the class is unknown.
   */
  cpus?: number
}

/** Keep memory below the OOM limit and leave a vCPU spare for the next class up. */
const HEADROOM = 1.25

function finite(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function percentile(values: number[], ratio: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

export function recommendFlyWorkerSize(profile: FlyJobProfile, history: FlyUsageSample[]): FlyMachineSpec {
  const vcpuP95 = percentile(history.map(sample => sample.cpuPercent / 100 * finite(sample.cpus, 1)), 0.95)
  const memoryP95 = percentile(history.map(sample => sample.memoryMb), 0.95)
  // A job that runs CPU-bound for ten minutes needs a core to itself even without history.
  const vcpu = Math.max(vcpuP95, finite(profile.estimatedCpuSeconds) > 600 ? 1 : 0) * HEADROOM
  const memory = Math.max(memoryP95, finite(profile.estimatedMemoryMb)) * HEADROOM

  if (profile.requiresBrowser) {
    return memory > 4096 || vcpu > FLY_WORKER_SPECS['browser-standard'].cpus
      ? FLY_WORKER_SPECS['browser-large'] : FLY_WORKER_SPECS['browser-standard']
  }
  if (profile.requiresBuild || memory > 4096) return FLY_WORKER_SPECS['core-xlarge']
  if (memory > 2048 || vcpu > FLY_WORKER_SPECS['core-standard'].cpus || profile.requiresTesting) return FLY_WORKER_SPECS['core-performance']
  // A dependency install measured a 596 MiB peak against a 1 GiB class; keep headroom.
  if (memory > 1024 || vcpu > 0.5 || profile.requiresDependencies) return FLY_WORKER_SPECS['core-standard']
  return FLY_WORKER_SPECS['core-small']
}
