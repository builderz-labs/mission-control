import { describe, expect, it, vi } from 'vitest'
import { FlyMachinesClient, FlyMachinesError } from '@/lib/fly-machines-client'
import { isFlyWorkerImageRef } from '@/lib/fly-orchestrator'
import {
  recommendFlyWorkerSize,
} from '@/lib/fly-workers'

describe('Fly worker policy', () => {
  it('accepts only immutable digests from the configured worker app', () => {
    const digest = 'a'.repeat(64)
    expect(isFlyWorkerImageRef(`registry.fly.io/mission-control-workers-tyler@sha256:${digest}`, 'mission-control-workers-tyler')).toBe(true)
    expect(isFlyWorkerImageRef('registry.fly.io/mission-control-workers-tyler:core-0.153.4-amd64', 'mission-control-workers-tyler')).toBe(false)
    expect(isFlyWorkerImageRef('registry.fly.io/mission-control-workers-tyler@sha256:abc', 'mission-control-workers-tyler')).toBe(false)
    expect(isFlyWorkerImageRef('registry.fly.io/other-app:core', 'mission-control-workers-tyler')).toBe(false)
  })



  it('sizes from p95 resource history and job requirements', () => {
    expect(recommendFlyWorkerSize({ estimatedMemoryMb: 3000 }, []).size).toBe('core-performance')
    expect(recommendFlyWorkerSize({ requiresBrowser: true }, [{ cpuPercent: 90, memoryMb: 5000, runtimeSeconds: 1, costUsd: 0 }]).size)
      .toBe('browser-large')
    expect(recommendFlyWorkerSize({ requiresTesting: true }, []).size).toBe('core-performance')
    expect(recommendFlyWorkerSize({ requiresBuild: true }, []).size).toBe('core-xlarge')
    expect(recommendFlyWorkerSize({ estimatedMemoryMb: 6144 }, []).size).toBe('core-xlarge')
  })

  it('reads a CPU sample as a share of the machine that produced it, not as an absolute', () => {
    const sample = (cpuPercent: number, cpus: number) => [{ cpuPercent, memoryMb: 200, runtimeSeconds: 60, costUsd: 0, cpus }]
    // Half of a four-vCPU machine is two vCPUs and must not read the same as half of one vCPU.
    expect(recommendFlyWorkerSize({ requiresBrowser: true }, sample(50, 4)).size).toBe('browser-large')
    expect(recommendFlyWorkerSize({ requiresBrowser: true }, sample(50, 2)).size).toBe('browser-standard')
    // An unknown class is treated as the smallest, so a bare percent keeps its old meaning.
    expect(recommendFlyWorkerSize({}, [{ cpuPercent: 20, memoryMb: 200, runtimeSeconds: 60, costUsd: 0 }]).size).toBe('core-small')
  })

  it('reproduces the measured sizing decisions for the smoke profile', () => {
    // Task 49 saturated its single vCPU, so the next job is correctly moved up a class.
    const task49 = { cpuPercent: 99.38, memoryMb: 196, runtimeSeconds: 44, costUsd: 0.00018172, cpus: 1 }
    expect(recommendFlyWorkerSize({}, [task49]).size).toBe('core-performance')
    // Task 61 then used 1.08 vCPU of two, which must hold the class rather than oscillate back down.
    const task61 = { cpuPercent: 54.18, memoryMb: 201, runtimeSeconds: 53, costUsd: 0.00126776, cpus: 2 }
    expect(recommendFlyWorkerSize({}, [task49, task61]).size).toBe('core-performance')
    // A job that never needed the larger class does step back down once its history says so.
    const light = { cpuPercent: 30.16, memoryMb: 279, runtimeSeconds: 289, costUsd: 0.0006358, cpus: 2 }
    expect(recommendFlyWorkerSize({}, [light]).size).toBe('core-standard')
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
  it('retains cleanup ownership until the Machine is observed absent', async () => {
    const fetchImpl=vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:202}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:'m1'})))
      .mockResolvedValueOnce(new Response(null,{status:202}))
      .mockResolvedValueOnce(new Response(null,{status:404}))
    const client=new FlyMachinesClient({apiToken:'token',appName:'mc',fetchImpl})
    await expect(client.destroyMachine('m1')).rejects.toThrow('not yet confirmed')
    await expect(client.destroyMachine('m1')).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error')
  })
})
