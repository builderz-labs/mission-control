import os from 'node:os'
import { runCommand } from './command'

export interface HostMetrics {
  cpuPercent: number
  cpuBasis?: string
  memoryPercent: number
  swapBytes: number
}

function cpuSnapshot() {
  return os.cpus().reduce((sum,cpu) => ({ idle: sum.idle+cpu.times.idle,
    total: sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0) }),{idle:0,total:0})
}
let previous = { ...cpuSnapshot(), at: Date.now() }
let measuredCpu: number | null = null

function measureCpu() {
  const now = Date.now()
  if (now-previous.at < 250) return measuredCpu
  const next = cpuSnapshot()
  const elapsed = next.total-previous.total
  if (elapsed > 0) measuredCpu = Math.round(Math.max(0,Math.min(100,100*(1-(next.idle-previous.idle)/elapsed))))
  previous = { ...next, at: now }
  return measuredCpu
}

function usagePercent(): number {
  const total = os.totalmem()
  return total > 0 ? Math.round(((total - os.freemem()) / total) * 100) : 0
}

async function swapBytes(): Promise<number> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await runCommand('sysctl', ['-n', 'vm.swapusage'], { timeoutMs: 1500 })
      const match = stdout.match(/used\s*=\s*([\d.]+)M/i)
      return match ? Math.round(Number(match[1]) * 1024 * 1024) : 0
    }
    const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 1500 })
    const line = stdout.split('\n').find(value => value.startsWith('Swap:'))
    return line ? Number(line.trim().split(/\s+/)[2]) || 0 : 0
  } catch {
    return 0
  }
}

/** A bounded live host snapshot for scheduler and fleet visualizations. */
export async function getHostMetrics(): Promise<HostMetrics> {
  const cpu = measureCpu()
  return { cpuPercent: cpu ?? 0, cpuBasis: cpu === null ? 'sampling' : 'CPU time delta', memoryPercent: usagePercent(), swapBytes: await swapBytes() }
}
