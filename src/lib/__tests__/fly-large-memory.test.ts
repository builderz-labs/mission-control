import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
describe('Explicitly approved 9 GiB Fly workers', () => {
  it.each(['', '16384', '-1', 'NaN'])('keeps the 8 GiB default for unapproved setting %s', async (value) => {
    vi.resetModules(); vi.stubEnv('MC_FLY_LARGE_MEMORY_MB', value)
    const { FLY_WORKER_SPECS } = await import('@/lib/fly-workers')
    expect(FLY_WORKER_SPECS['core-xlarge'].memoryMb).toBe(8192)
    expect(FLY_WORKER_SPECS['browser-large'].memoryMb).toBe(8192)
  })
  it('admits measured peaks with safety headroom only at the approved size and explicit price', async () => {
    vi.resetModules(); vi.stubEnv('MC_FLY_LARGE_MEMORY_MB', '9216')
    vi.stubEnv('MC_FLY_CORE_XLARGE_HOURLY_USD', '')
    vi.stubEnv('MC_FLY_CORE_PERFORMANCE_HOURLY_USD', '0.086112')
    vi.stubEnv('MC_FLY_CORE_IMAGE', `registry.fly.io/mission-control-workers-tyler@sha256:${'a'.repeat(64)}`)
    vi.stubEnv('MC_FLY_WORKER_APP', 'mission-control-workers-tyler')
    vi.stubEnv('MC_FLY_PER_JOB_BUDGET_USD', '0.25')
    const { pricedFlyJob } = await import('@/lib/fly-pricing')
    const input = { setup: 'pnpm-ci' as const, checks: ['build' as const], timeout_seconds: 1800 }
    const history = [{ cpuPercent: 70, memoryMb: 7314.4, runtimeSeconds: 120, costUsd: 0.01, cpus: 4 }]
    expect(pricedFlyJob(input, history).issues).toContain('Compute price for core-xlarge is missing')
    vi.stubEnv('MC_FLY_CORE_XLARGE_HOURLY_USD', '0.179169')
    const result = pricedFlyJob(input, history)
    expect(result.spec.memoryMb).toBe(9216)
    expect(result.issues).toEqual([])
    expect(result.reserve).toBeLessThan(0.25)
    expect(pricedFlyJob(input, [{ ...history[0], memoryMb: 8000 }]).issues).toContain('Historical memory exceeds the largest approved class with safety headroom')
    vi.stubEnv('MC_FLY_PER_JOB_BUDGET_USD', '0.01')
    expect(pricedFlyJob(input, history).issues).toContain('Per-job compute budget exceeded')
  })
})
