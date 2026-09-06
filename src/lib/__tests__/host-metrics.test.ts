// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import os from 'node:os'
import { getHostMetrics } from '../host-metrics'
import { runCommand } from '../command'
vi.mock('../command',()=>({runCommand:vi.fn(async()=>({stdout:'total = 100M used = 2M free = 98M',stderr:'',code:0}))}))
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('samples CPU time deltas without treating load average as CPU percent',async()=>{
  vi.useFakeTimers()
  const cpu={model:'fixture',speed:1,times:{user:100,nice:0,sys:0,idle:100,irq:0}}
  vi.spyOn(os,'cpus').mockReturnValue([cpu])
  await vi.advanceTimersByTimeAsync(1000);await getHostMetrics()
  vi.mocked(os.cpus).mockReturnValue([{...cpu,times:{...cpu.times,user:150,idle:150}}])
  await vi.advanceTimersByTimeAsync(1000)
  expect(await getHostMetrics()).toMatchObject({cpuPercent:50,cpuBasis:'CPU time delta'})
  expect(runCommand).toHaveBeenCalled()
})
