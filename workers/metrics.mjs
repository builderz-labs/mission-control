import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'

export function createResourceSampler({ read = file => readFile(file, 'utf8'), now = Date.now, cores = availableParallelism } = {}) {
  let previousCpu; let previousTime
  async function text(file) { try { return await read(file) } catch { return undefined } }
  async function count(file) {
    const value = await text(file)
    return value !== undefined && /^\d+\s*$/.test(value) ? Number(value.trim()) : undefined
  }
  return async function sample() {
    const stat = await text('/sys/fs/cgroup/cpu.stat')
    let cpu = stat?.match(/^usage_usec (\d+)$/m)?.[1]
    cpu = cpu === undefined ? undefined : Number(cpu)
    if (cpu === undefined) {
      const nanos = await count('/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage') ?? await count('/sys/fs/cgroup/cpuacct/cpuacct.usage')
      if (nanos !== undefined) cpu = nanos / 1000
    }
    const at = now(); const metrics = {}
    if (cpu !== undefined && previousCpu !== undefined && at > previousTime && cpu >= previousCpu) {
      metrics.cpu_percent = Math.round(Math.min(100, (cpu - previousCpu) / (at - previousTime) / 10 / cores()) * 100) / 100
    }
    previousCpu = cpu; previousTime = at
    const memory = await count('/sys/fs/cgroup/memory.current') ?? await count('/sys/fs/cgroup/memory/memory.usage_in_bytes')
    let swap = await count('/sys/fs/cgroup/memory.swap.current')
    if (swap === undefined && memory !== undefined) {
      const combined = await count('/sys/fs/cgroup/memory/memory.memsw.usage_in_bytes')
      if (combined !== undefined) swap = Math.max(0, combined - memory)
    }
    if (memory !== undefined) metrics.memory_bytes = memory
    if (swap !== undefined) metrics.swap_bytes = swap
    return metrics
  }
}
