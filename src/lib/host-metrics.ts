import os from 'node:os'
import { runCommand } from './command'

export interface HostMetrics {
  cpuPercent: number
  memoryPercent: number
  swapBytes: number
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
  const cpuPercent = Math.round(Math.min(100, (os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100))
  return { cpuPercent, memoryPercent: usagePercent(), swapBytes: await swapBytes() }
}
