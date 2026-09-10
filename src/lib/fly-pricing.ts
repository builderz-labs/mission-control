import type { FlySubmission } from './fly-admission-schema'
import { recommendFlyWorkerSize, type FlyUsageSample } from './fly-workers'
import { isFlyWorkerImageRef } from './fly-orchestrator'

export function pricedFlyJob(input: Pick<FlySubmission, 'setup' | 'checks' | 'timeout_seconds'>, history: FlyUsageSample[] = []) {
  const browser = input.setup.endsWith('-playwright')
  const spec = recommendFlyWorkerSize({
    requiresBrowser: browser,
    requiresDependencies: input.setup !== 'none',
    requiresTesting: input.checks.some(check => check !== 'smoke'),
    requiresBuild: input.checks.includes('build'),
    estimatedMemoryMb: input.checks.includes('build') ? 6144 : undefined,
  }, history)
  const envRate = Number(process.env[`MC_FLY_${spec.size.replaceAll('-', '_').toUpperCase()}_HOURLY_USD`])
  const fallbackRate = spec.size === 'core-xlarge'
    ? Number(process.env.MC_FLY_CORE_PERFORMANCE_HOURLY_USD) * 2
    : 0
  const rawRate = Number.isFinite(envRate) && envRate > 0 ? envRate : fallbackRate
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0
  const image = browser ? process.env.MC_FLY_BROWSER_IMAGE : process.env.MC_FLY_CORE_IMAGE
  const ttl = input.timeout_seconds + 300
  const reserve = rate * ttl / 3600
  const issues: string[] = []
  if (!isFlyWorkerImageRef(image)) issues.push(`Immutable ${spec.workerClass} image is missing`)
  if (!rate) issues.push(`Compute price for ${spec.size} is missing`)
  if (history.some(sample => sample.memoryMb * 1.25 > spec.memoryMb)) issues.push('Historical memory exceeds the largest approved class with safety headroom')
  if (reserve > Number(process.env.MC_FLY_PER_JOB_BUDGET_USD || 0)) issues.push('Per-job compute budget exceeded')
  return { spec, image, rate, ttl, reserve, issues }
}
