import { describe, expect, it, vi } from 'vitest'
import { FlyMachinesClient, FlyMachinesError } from '@/lib/fly-machines-client'
import { isFlyWorkerImageRef } from '@/lib/fly-orchestrator'
import {
  FLY_WORKER_SPECS,
  decideFlyPlacement,
  estimateFlyJobCost,
  isFlyBudgetAllowed,
  recommendFlyWorkerSize,
} from '@/lib/fly-workers'

const budget = { dailySpentUsd: 1, monthlySpentUsd: 10, dailyLimitUsd: 20, monthlyLimitUsd: 100 }
const capacity = { enabled: true, networkAvailable: true, activeWorkers: 0, maxWorkers: 3 }

describe('Fly worker policy', () => {
  it('accepts only immutable digests from the configured worker app', () => {
    const digest = 'a'.repeat(64)
    expect(isFlyWorkerImageRef(`registry.fly.io/mission-control-workers-tyler@sha256:${digest}`, 'mission-control-workers-tyler')).toBe(true)
    expect(isFlyWorkerImageRef('registry.fly.io/mission-control-workers-tyler:core-0.153.4-amd64', 'mission-control-workers-tyler')).toBe(false)
    expect(isFlyWorkerImageRef('registry.fly.io/mission-control-workers-tyler@sha256:abc', 'mission-control-workers-tyler')).toBe(false)
    expect(isFlyWorkerImageRef('registry.fly.io/other-app:core', 'mission-control-workers-tyler')).toBe(false)
  })

  it('keeps Mac-only jobs local and routes browser jobs to Fly', () => {
    expect(decideFlyPlacement({ macOnly: true }, capacity, budget, []).route).toBe('local')
    const browser = decideFlyPlacement({ requiresBrowser: true }, capacity, budget, [])
    expect(browser).toMatchObject({ route: 'fly', workerClass: 'browser' })
  })

  it('sizes from p95 resource history and job requirements', () => {
    expect(recommendFlyWorkerSize({ estimatedMemoryMb: 3000 }, []).size).toBe('core-performance')
    expect(recommendFlyWorkerSize({ requiresBrowser: true }, [{ cpuPercent: 90, memoryMb: 5000, runtimeSeconds: 1, costUsd: 0 }]).size)
      .toBe('browser-large')
    expect(recommendFlyWorkerSize({ requiresTesting: true }, []).size).toBe('core-performance')
  })

  it('enforces capacity and all cost ceilings before dispatch', () => {
    expect(decideFlyPlacement({}, { ...capacity, activeWorkers: 3 }, budget, []).route).toBe('deferred')
    expect(isFlyBudgetAllowed({ perJobBudgetUsd: 1 }, 2, budget)).toBe(false)
    expect(isFlyBudgetAllowed({}, 20, budget)).toBe(false)
  })

  it('uses configured hourly pricing for the dispatch budget decision', () => {
    const priced = { ...FLY_WORKER_SPECS['core-small'], hourlyCostUsd: 0.12 }
    const placement = decideFlyPlacement({ predictedRuntimeSeconds: 3600 }, capacity, { ...budget, dailySpentUsd: 19.9 }, [], priced)
    expect(placement.route).toBe('deferred')
    expect(placement.reason).toMatch(/budget/i)
  })

  it('calculates a machine runtime estimate from its configured rate', () => {
    const spec = { ...FLY_WORKER_SPECS['core-small'], hourlyCostUsd: 0.12 }
    expect(estimateFlyJobCost({ predictedRuntimeSeconds: 1800 }, spec)).toBe(0.06)
  })
})

describe('Fly Machines client', () => {
  it('is gated until credentials are configured', async () => {
    const client = new FlyMachinesClient({})
    expect(client.isEnabled()).toBe(false)
    await expect(client.listMachines()).rejects.toBeInstanceOf(FlyMachinesError)
  })

  it('retries transient failures and sends the correct app endpoint', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'm1', state: 'started' }]), { status: 200 }))
    const sleep = vi.fn(async () => undefined)
    const client = new FlyMachinesClient({ apiToken: 'token', appName: 'mc', fetchImpl, sleep, retries: 1 })
    await expect(client.listMachines()).resolves.toEqual([{ id: 'm1', state: 'started' }])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/apps/mc/machines')
    expect(sleep).toHaveBeenCalledWith(100)
  })

  it('does not retry authorization failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }))
    const client = new FlyMachinesClient({ apiToken: 'token', appName: 'mc', fetchImpl, retries: 2 })
    await expect(client.destroyMachine('m1')).rejects.toMatchObject({ status: 401 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
